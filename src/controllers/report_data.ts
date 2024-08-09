import EnumConstant from "../utils/enumConstant";
import models, { ObjectId } from "../models";
import controllers from ".";
import CommonUtil from "../utils/common";

export default class SubjectController {
  async filterDataApprovedList(req: any) {
    let query: any = {};
    if (req.body._user.schools) {
      query._id = req.body._user.schools;
    }
    let [schools, shifts, province] = await Promise.all([
      controllers.school.getManyNoCount({
        query: query,
        select: "name name_en profile_image",
      }),
      controllers.shift.getManyNoCount({
        query: { status: EnumConstant.ACTIVE },
        select: "name name_en",
      }),
      controllers.address.getManyNoCount({
        select: "name name_en",
      }),
    ]);
    return {
      schools: schools,
      shifts,
      scholarship_status: [
        EnumConstant.ACTIVE,
        EnumConstant.waiting,
        EnumConstant.FINISHED_STUDY,
        EnumConstant.QUIT_BFORE_COURSE,
        EnumConstant.QUIT_DURING_COURSE,
      ],
      student_occupations: ["មានការងារ"],
      student_internships: ["កំពុងកម្មសិក្សា"],
      city_provinces: province,
    };
  }
  async approvedList(req: any) {
    let {
      schools,
      shifts,
      scholarship_status,
      student_occupations,
      city_provinces,
    } = req.query;
    let [skip, limit] = controllers.student.skipLimit(req);
    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );
    let matchStudent: any = {
      status: EnumConstant.ACTIVE,
    };
    if (req.body._user.schools) {
      schools = req.body._user.schools;
    }
    if (schools) {
      matchStudent.schools = new ObjectId(schools);
    }
    let matchCourse: any = {};
    if (shifts) {
      matchCourse.shifts = new ObjectId(shifts);
    }
    let matchScholarshipStatus: any = {};
    let query: any = {
      status: EnumConstant.ACTIVE,
      timeline_type: EnumConstant.TimelineType.SCHOLARSHIP,
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (scholarship_status) {
      matchScholarshipStatus.scholarship_status = Number(scholarship_status);
      if (
        scholarship_status == EnumConstant.QUIT ||
        scholarship_status == EnumConstant.QUIT_DURING_COURSE ||
        scholarship_status == EnumConstant.QUIT_BFORE_COURSE
      ) {
        query.status = EnumConstant.QUIT;
      }
    }
    let matchStudentOccupations: any = {};

    if (student_occupations) {
      matchStudentOccupations.student_occupations = { $exists: true, $ne: [] };
    }

    let matchCityProvince: any = {};
    if (city_provinces) {
      matchCityProvince["address.city_provinces"] = Number(city_provinces);
    }

    let minToday = new Date(new Date(req.query.end_date).setHours(0, 0, 0));
    let maxToday = new Date(new Date(req.query.end_date).setHours(23, 59, 59));

    let data = await models.requestTimeline
      .aggregate([
        {
          $match: query,
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$students",
            createdAt: { $first: "$createdAt" },
          },
        },
        {
          $lookup: {
            from: "students",
            let: { id: "$_id", timelineCreatedAt: "$createdAt" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                  ...matchStudent,
                },
              },
              {
                $limit: 1,
              },
              {
                $lookup: {
                  from: "courses",
                  let: { ids: "$courses" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$ids"] },
                        ...matchCourse,
                      },
                    },
                  ],
                  as: "courses",
                },
              },
              { $unwind: { path: "$courses" } },
              {
                $lookup: {
                  from: "student_occupations",
                  let: { studentId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$students", "$$studentId"] },
                        has_job: 1,
                      },
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1 },
                  ],
                  as: "student_occupations",
                },
              },
              {
                $unwind: {
                  path: "$student_occupations",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $addFields: {
                  shifts: "$courses.shifts",
                  apply_majors: "$courses.apply_majors",
                  scholarship_status: {
                    $cond: {
                      if: {
                        $eq: ["$scholarship_status", EnumConstant.ACTIVE],
                      },
                      then: {
                        $cond: {
                          if: { $gt: ["$courses.course_start", maxToday] },
                          then: EnumConstant.waiting,
                          else: {
                            $cond: {
                              if: { $lt: ["$courses.course_end", minToday] },
                              then: EnumConstant.FINISHED_STUDY,
                              else: "$scholarship_status",
                            },
                          },
                        },
                      },
                      else: {
                        $cond: {
                          if: {
                            $eq: ["$scholarship_status", EnumConstant.QUIT],
                          },
                          then: {
                            $cond: {
                              if: {
                                $gt: [
                                  "$courses.course_start",
                                  "$$timelineCreatedAt",
                                ],
                              },
                              then: EnumConstant.QUIT_BFORE_COURSE,
                              else: {
                                $cond: {
                                  if: {
                                    $and: [
                                      {
                                        $lt: [
                                          "$courses.course_start",
                                          "$$timelineCreatedAt",
                                        ],
                                      },
                                      {
                                        $gt: [
                                          "$courses.course_end",
                                          "$$timelineCreatedAt",
                                        ],
                                      },
                                    ],
                                  },
                                  then: EnumConstant.QUIT_DURING_COURSE,
                                  else: "$scholarship_status",
                                },
                              },
                            },
                          },
                          else: "$scholarship_status",
                        },
                      },
                    },
                  },
                },
              },
            ],
            as: "students",
          },
        },
        {
          $unwind: "$students",
        },
        {
          $replaceRoot: {
            newRoot: "$students",
          },
        },
        {
          $project: {
            first_name: 1,
            last_name: 1,
            first_name_en: 1,
            last_name_en: 1,
            profile_image: 1,
            date_of_birth: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$date_of_birth",
              },
            },
            address: 1,
            place_of_birth: 1,
            gender: 1,
            poor_id: 1,
            schools: 1,
            phone_number: 1,
            apply_majors: 1,
            courses_end: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$courses.course_end",
              },
            },
            courses_start: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$courses.course_start",
              },
            },
            courses_code: "$courses.code",
            shifts: 1,
            scholarship_status: 1,
            type_poverty_status: 1,
            id_card_number: 1,
            student_occupations: 1,
            createdAt: {
              $dateToString: {
                format: "%Y-%m-%d %H:%M:%S",
                date: "$createdAt",
              },
            },
            updatedAt: {
              $dateToString: {
                format: "%Y-%m-%d %H:%M:%S",
                date: "$updatedAt",
              },
            },
          },
        },
        {
          $match: {
            ...matchScholarshipStatus,
            ...matchStudentOccupations,
            ...matchCityProvince,
          },
        },

        { $sort: { last_name: 1, first_name: 1 } },
        {
          $facet: {
            result: [
              { $skip: skip },
              ...(limit > 0 ? [{ $limit: limit }] : []),
              {
                $lookup: {
                  from: "attendance_students",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$students", "$$id"] },
                        date: { $gte: startDate, $lte: endDate },
                        status: EnumConstant.ACTIVE,
                      },
                    },
                    {
                      $group: {
                        _id: null,
                        total_score: { $sum: "$attendance_score" },
                        divide: { $sum: 1 },
                      },
                    },
                    {
                      $addFields: {
                        average_attendance: {
                          $round: [{ $divide: ["$total_score", "$divide"] }, 0],
                        },
                      },
                    },
                  ],
                  as: "attendance_students",
                },
              },
              {
                $addFields: {
                  average_attendance: {
                    $concat: [
                      {
                        $toString: {
                          $ifNull: [
                            {
                              $arrayElemAt: [
                                "$attendance_students.average_attendance",
                                0,
                              ],
                            },
                            0,
                          ],
                        },
                      },
                      "%",
                    ],
                  },
                },
              },
              {
                $project: {
                  attendance_students: 0,
                },
              },
            ],
            totalCount: [
              {
                $count: "count",
              },
            ],
          },
        },
      ])
      .allowDiskUse(true);
    let [getData, count] = await controllers.student.facetData(data, [
      {
        path: "schools",
        select: "name name_en profile_image",
        model: "schools",
      },
      { path: "apply_majors", select: "name name_en", model: "skills" },
      { path: "shifts", select: "name name_en", model: "shifts" },
      { path: "address.villages", select: "name name_en" },
      { path: "address.communes", select: "name name_en" },
      { path: "address.districts", select: "name name_en" },
      { path: "address.city_provinces", select: "name name_en" },
      { path: "place_of_birth.villages", select: "name name_en" },
      { path: "place_of_birth.communes", select: "name name_en" },
      { path: "place_of_birth.districts", select: "name name_en" },
      { path: "place_of_birth.city_provinces", select: "name name_en" },
      {
        path: "student_occupations.company_profile.address.villages",
        select: "name name_en",
        model: "villages",
      },
      {
        path: "student_occupations.company_profile.address.communes",
        select: "name name_en",
        model: "communes",
      },
      {
        path: "student_occupations.company_profile.address.districts",
        select: "name name_en",
        model: "districts",
      },
      {
        path: "student_occupations.company_profile.address.city_provinces",
        select: "name name_en",
        model: "city_provinces",
      },
    ]);
    let json = CommonUtil.JSONParse(getData);
    json = json.map((item: any) => {
      let data = item;
      let placeBirth = "";
      if (item.place_of_birth) {
        if (item.place_of_birth.city_provinces) {
          placeBirth = item.place_of_birth.city_provinces.name;
        }
        if (item.place_of_birth.districts) {
          placeBirth += ", " + item.place_of_birth.districts.name;
        }
        if (item.place_of_birth.communes) {
          placeBirth += ", " + item.place_of_birth.communes.name;
        }
        if (item.place_of_birth.villages) {
          placeBirth += ", " + item.place_of_birth.villages.name;
        }
        if (item.place_of_birth.detail) {
          placeBirth += ", " + item.place_of_birth.detail;
        }
        data.place_of_birth.name = placeBirth;
      }
      let address = "";
      if (item.address) {
        if (item.address.city_provinces) {
          address = item.address.city_provinces.name;
        }
        if (item.address.districts) {
          address += ", " + item.address.districts.name;
        }
        if (item.address.communes) {
          address += ", " + item.address.communes.name;
        }
        if (item.address.villages) {
          address += ", " + item.address.villages.name;
        }
        if (item.address.detail) {
          address += ", " + item.address.detail;
        }
        data.address.name = address;
      }
      let addressCompany = "";
      if (item?.student_occupations?.company_profile?.address) {
        if (item.address.city_provinces) {
          addressCompany =
            item?.student_occupations?.company_profile?.address?.city_provinces
              .name;
        }
        if (item.student_occupations?.company_profile?.address.districts) {
          addressCompany +=
            ", " +
            item.student_occupations?.company_profile?.address.districts.name;
        }
        if (item.student_occupations?.company_profile?.address.communes) {
          addressCompany +=
            ", " +
            item.student_occupations?.company_profile?.address.communes.name;
        }
        if (item.student_occupations?.company_profile?.address.villages) {
          addressCompany +=
            ", " +
            item.student_occupations?.company_profile?.address.villages.name;
        }
        if (item.student_occupations?.company_profile?.address.detail) {
          addressCompany +=
            ", " + item.student_occupations?.company_profile?.address.detail;
        }
        data.student_occupations.company_profile.address.company_address =
          addressCompany;
      }
      return data;
    });
    return [json, count];
  }

  async filterData(req: any) {
    let querySchool: any = {
      status: EnumConstant.ACTIVE,
    };
    if (req.body._user.schools) {
      querySchool._id = req.body._user.schools;
    }
    let [getShifts, getMajors, getSchools, getTypeScholarshipDocument] =
      await Promise.all([
        controllers.shift.getManyNoCount({
          query: { status: { $ne: EnumConstant.DELETE } },
          select: "name name_en",
        }),
        controllers.applyMajor.getManyNoCount({
          query: { status: { $ne: EnumConstant.DELETE } },
          select: "name name_en",
        }),
        controllers.school.getManyNoCount({
          query: querySchool,
          select: "name name_en",
        }),
        controllers.typeScholarshipDocument.getManyNoCount({
          // query: {status: {$ne: EnumConstant.DELETE}},
          select: "name name_en",
        }),
      ]);
    return {
      shifts: getShifts,
      apply_majors: getMajors,
      schools: getSchools,
      type_poverty_status: [
        {
          _id: EnumConstant.TypePovertyStatus.POOR_1,
          name: "ក្រ១",
        },
        {
          _id: EnumConstant.TypePovertyStatus.POOR_2,
          name: "ក្រ២",
        },
        {
          _id: EnumConstant.TypePovertyStatus.NEAR_POOR,
          name: "ងាយរងហានិភ័យ",
        },
        {
          _id: EnumConstant.TypePovertyStatus.NOT_POOR,
          name: "ទូទៅ",
        },
      ],
      type_scholarship_documents: getTypeScholarshipDocument,
    };
  }

  private totalValue(columns: any[], data: any[]) {
    let jsonData: any = [];
    jsonData = CommonUtil.JSONParse(columns);
    for (var j = 0; j < jsonData.length; j++) {
      jsonData[j].total_female = 0;
      jsonData[j].total_student = 0;
      jsonData[j].total_course_finish = 0;
      jsonData[j].total_new_course_finish = 0;
    }
    for (var i = 0; i < data.length; i++) {
      for (var j = 0; j < jsonData.length; j++) {
        jsonData[j].total_female += data[i].student_data[j].total_female;
        jsonData[j].total_student += data[i].student_data[j].total_student;
        jsonData[j].total_course_finish +=
          data[i].student_data[j].total_course_finish;
        jsonData[j].total_new_course_finish +=
          data[i].student_data[j].total_new_course_finish;
      }
    }
    return jsonData;
  }

  async studentApplyBySchool(req: any) {
    let { apply_majors, shifts, schools, type_poverty_status } = req.query;
    let querySchool: any = {
      status: EnumConstant.ACTIVE,
    };
    if (schools) {
      querySchool._id = new ObjectId(schools);
    }
    if (req.body._user.schools) {
      querySchool._id = new ObjectId(req.body._user.schools);
    }
    let queryCourse: any = {
      status: { $ne: EnumConstant.DELETE },
    };
    if (apply_majors) {
      queryCourse.apply_majors = apply_majors;
    }
    if (shifts) {
      queryCourse.shifts = shifts;
    }
    let matchStudentCourse: any = {};
    if (apply_majors || shifts) {
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchStudentCourse.courses = { $in: getCourses.map((item) => item._id) };
    }

    let matchPoor: any = {};
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }

    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );

    let data = await models.school
      .aggregate([
        {
          $match: querySchool,
        },
        {
          $lookup: {
            from: "students",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$schools", "$$id"] },
                  ...matchStudentCourse,
                  ...matchPoor,
                },
              },
              {
                $lookup: {
                  from: "request_timelines",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$students", "$$id"] },
                        status: EnumConstant.REQUESTING,
                        timeline_type: EnumConstant.TimelineType.SCHOLARSHIP,
                        createdAt: { $gte: startDate, $lte: endDate },
                        resubmit: { $ne: EnumConstant.ACTIVE },
                      },
                    },
                    {
                      $limit: 1,
                    },
                  ],
                  as: "request_timelines",
                },
              },
              { $unwind: { path: "$request_timelines" } },
              {
                $lookup: {
                  from: "staffs",
                  let: { id: "$create_by" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$id"] },
                      },
                    },
                    {
                      $project: {
                        schools: 1,
                        user_departments: 1,
                      },
                    },
                  ],
                  as: "create_by",
                },
              },
              {
                $unwind: {
                  path: "$create_by",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $group: {
                  _id: {
                    user_departments: "$create_by.user_departments",
                    create_by_schools: "$create_by.schools",
                  },
                  total_student: { $sum: 1 },
                  total_female: {
                    $sum: {
                      $cond: [
                        { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                        1,
                        0,
                      ],
                    },
                  },
                  has_id_poor: {
                    $sum: {
                      $cond: [{ $ifNull: ["$poor_id", false] }, 1, 0],
                    },
                  },
                  has_id_poor_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                            { $ifNull: ["$poor_id", false] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  self_apply_student: {
                    $sum: {
                      $cond: [{ $ifNull: ["$create_by", false] }, 0, 1],
                    },
                  },
                  self_apply_female: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$create_by", false] },
                        0,
                        {
                          $cond: [
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                            1,
                            0,
                          ],
                        },
                      ],
                    },
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  total_student: { $sum: "$total_student" },
                  total_female: { $sum: "$total_female" },
                  has_id_poor: { $sum: "$has_id_poor" },
                  has_id_poor_female: { $sum: "$has_id_poor_female" },
                  self_apply_student: { $sum: "$self_apply_student" },
                  self_apply_female: { $sum: "$self_apply_female" },
                  user_departments: {
                    $push: {
                      $cond: [
                        { $ifNull: ["$_id.user_departments", false] },
                        {
                          user_departments: "$_id.user_departments",
                          total_student: "$total_student",
                          total_female: "$total_female",
                        },
                        "$$REMOVE",
                      ],
                    },
                  },
                  school_apply_student: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$_id.create_by_schools", false] },
                        "$total_student",
                        0,
                      ],
                    },
                  },
                  school_apply_female: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$_id.create_by_schools", false] },
                        "$total_female",
                        0,
                      ],
                    },
                  },
                },
              },
              {
                $project: { _id: 0 },
              },
            ],
            as: "student_data",
          },
        },
        {
          $unwind: { path: "$student_data", preserveNullAndEmptyArrays: true },
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                {
                  _id: "$_id",
                  name: "$name",
                  name_en: "$name_en",
                  address: "$address",
                  profile_image: "$profile_image",
                  code: "$code",
                  id_code: "$id_code",
                },
                "$student_data",
              ],
            },
          },
        },
        {
          $addFields: {
            total_student: {
              $cond: [
                { $ifNull: ["$total_student", false] },
                "$total_student",
                0,
              ],
            },
            total_female: {
              $cond: [
                { $ifNull: ["$total_female", false] },
                "$total_female",
                0,
              ],
            },
            has_id_poor: {
              $cond: [{ $ifNull: ["$has_id_poor", false] }, "$has_id_poor", 0],
            },
            has_id_poor_female: {
              $cond: [
                { $ifNull: ["$has_id_poor_female", false] },
                "$has_id_poor_female",
                0,
              ],
            },
            self_apply_student: {
              $cond: [
                { $ifNull: ["$self_apply_student", false] },
                "$self_apply_student",
                0,
              ],
            },
            self_apply_female: {
              $cond: [
                { $ifNull: ["$self_apply_female", false] },
                "$self_apply_female",
                0,
              ],
            },
            school_apply_student: {
              $cond: [
                { $ifNull: ["$school_apply_student", false] },
                "$school_apply_student",
                0,
              ],
            },
            school_apply_female: {
              $cond: [
                { $ifNull: ["$school_apply_female", false] },
                "$school_apply_female",
                0,
              ],
            },
            user_departments: {
              $cond: [
                { $ifNull: ["$user_departments", false] },
                "$user_departments",
                [],
              ],
            },
          },
        },
        {
          $sort: {
            id_code: 1,
          },
        },
        {
          $group: {
            _id: "$address.city_provinces",
            schools: { $push: "$$ROOT" },
            total_student: { $sum: "$total_student" },
            total_female: { $sum: "$total_female" },
            has_id_poor: { $sum: "$has_id_poor" },
            has_id_poor_female: { $sum: "$has_id_poor_female" },
            self_apply_student: { $sum: "$self_apply_student" },
            self_apply_female: { $sum: "$self_apply_female" },
            school_apply_student: { $sum: "$school_apply_student" },
            school_apply_female: { $sum: "$school_apply_female" },
          },
        },
        {
          $lookup: {
            from: "city_provinces",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "city_provinces",
          },
        },
        {
          $unwind: {
            path: "$city_provinces",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            name: "$city_provinces.name",
            name_en: "$city_provinces.name_en",
          },
        },
        {
          $sort: {
            "city_provinces.order": 1,
          },
        },
        {
          $project: {
            city_provinces: 0,
            "schools.address": 0,
          },
        },
      ])
      .allowDiskUse(true);
    // return data;
    let groupDeparts: any = [];
    for (var i = 0; i < data.length; i++) {
      for (var schs = 0; schs < data[i].schools.length; schs++) {
        data[i].schools[schs].user_departments.forEach((item: any) => {
          groupDeparts.push(String(item.user_departments));
        });
      }
    }
    let getDeparts = await controllers.userDepartment.getManyNoCount({
      query: {
        _id: { $in: groupDeparts },
        status: { $ne: EnumConstant.DELETE },
      },
      select: "name name_en",
    });
    let headerColumns: any = [];
    headerColumns.push({ _id: 1, name: "ដោយខ្លួនឯង" });
    headerColumns.push({ _id: 2, name: "គ្រឹស្ថានសិក្សា" });
    headerColumns.push(...getDeparts);
    headerColumns.push({ _id: 3, name: "មានបណ្ឌសមធម៌" });
    headerColumns.push({ _id: 4, name: "សរុបរួម" });
    let jsonData = CommonUtil.JSONParse(data);
    let keyToRemove = [
      "has_id_poor",
      "has_id_poor_female",
      "self_apply_student",
      "self_apply_female",
      "school_apply_student",
      "school_apply_female",
      "user_departments",
      "total_student",
      "total_female",
    ];
    for (var i = 0; i < jsonData.length; i++) {
      let cityData: any = [];
      cityData.push({
        _id: 1,
        total_student: jsonData[i].self_apply_student,
        total_female: jsonData[i].self_apply_female,
      });
      cityData.push({
        _id: 2,
        total_student: jsonData[i].school_apply_student,
        total_female: jsonData[i].school_apply_female,
      });
      let cityUserDeparts: any = CommonUtil.JSONParse(getDeparts);
      for (var city = 0; city < cityUserDeparts.length; city++) {
        cityUserDeparts[city].total_student = 0;
        cityUserDeparts[city].total_female = 0;
      }
      for (var schs = 0; schs < jsonData[i].schools.length; schs++) {
        let item: any = jsonData[i].schools[schs];
        let schoolData: any = [];
        schoolData.push({
          _id: 1,
          total_student: item.self_apply_student,
          total_female: item.self_apply_female,
        });
        schoolData.push({
          _id: 2,
          total_student: item.school_apply_student,
          total_female: item.school_apply_female,
        });
        for (var dep = 0; dep < getDeparts.length; dep++) {
          let exist = false;
          let getDept = getDeparts[dep];
          for (
            var depart = 0;
            depart < item.user_departments.length;
            depart++
          ) {
            if (
              String(item.user_departments[depart].user_departments) ==
              String(getDept._id)
            ) {
              schoolData.push({
                _id: item.user_departments[depart].user_departments,
                total_student: item.user_departments[depart].total_student,
                total_female: item.user_departments[depart].total_female,
              });
              cityUserDeparts[dep].total_student +=
                item.user_departments[depart].total_student;
              cityUserDeparts[dep].total_female +=
                item.user_departments[depart].total_female;
              exist = true;
              break;
            }
          }
          if (!exist) {
            schoolData.push({
              _id: getDept._id,
              total_student: 0,
              total_female: 0,
            });
          }
        }
        schoolData.push({
          _id: 3,
          total_student: item.has_id_poor,
          total_female: item.has_id_poor_female,
        });
        schoolData.push({
          _id: 4,
          total_student: item.total_student,
          total_female: item.total_female,
        });
        jsonData[i].schools[schs].student_data = schoolData;
        jsonData[i].schools[schs] = CommonUtil.removeKeys(
          jsonData[i].schools[schs],
          keyToRemove
        );
      }
      cityData.push(...cityUserDeparts);
      cityData.push({
        _id: 3,
        total_student: jsonData[i].has_id_poor,
        total_female: jsonData[i].has_id_poor_female,
      });
      cityData.push({
        _id: 4,
        total_student: jsonData[i].total_student,
        total_female: jsonData[i].total_female,
      });
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
      jsonData[i].student_data = cityData;
    }
    return {
      start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async studentApplyBySchoolByMajor(req: any) {
    let { apply_majors, shifts, schools, type_poverty_status } = req.query;
    if (req.body._user.schools) {
      schools = req.body._user.schools;
    }
    let queryMajor: any = {
      status: EnumConstant.ACTIVE,
      type_projects: EnumConstant.TypeProject.scholarship,
    };
    if (apply_majors) {
      queryMajor._id = new ObjectId(apply_majors);
    }
    let matchCourse: any = {};
    if (shifts || schools) {
      let queryCourse: any = {
        status: { $ne: EnumConstant.DELETE },
      };
      if (shifts) {
        queryCourse.shifts = shifts;
      }
      if (schools) {
        queryCourse.schools = new ObjectId(schools);
      }
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchCourse._id = { $in: getCourses.map((item) => item._id) };
    }
    let matchPoor: any = {};
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );
    let data = await models.applyMajor
      .aggregate([
        {
          $match: queryMajor,
        },
        {
          $lookup: {
            from: "courses",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$apply_majors", "$$id"] },
                  // status: { $ne: EnumConstant.DELETE },
                  ...matchCourse,
                },
              },
              {
                $lookup: {
                  from: "students",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$courses", "$$id"] },
                        ...matchPoor,
                      },
                    },
                    {
                      $lookup: {
                        from: "request_timelines",
                        let: { id: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$students", "$$id"] },
                              status: EnumConstant.REQUESTING,
                              timeline_type:
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              createdAt: { $gte: startDate, $lte: endDate },
                              resubmit: { $ne: EnumConstant.ACTIVE },
                            },
                          },
                          {
                            $limit: 1,
                          },
                        ],
                        as: "request_timelines",
                      },
                    },
                    { $unwind: { path: "$request_timelines" } },
                    {
                      $lookup: {
                        from: "staffs",
                        let: { id: "$create_by" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$_id", "$$id"] },
                            },
                          },
                          {
                            $project: {
                              schools: 1,
                              user_departments: 1,
                            },
                          },
                        ],
                        as: "create_by",
                      },
                    },
                    {
                      $unwind: {
                        path: "$create_by",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                  ],
                  as: "students",
                },
              },
              { $unwind: { path: "$students" } },
            ],
            as: "courses",
          },
        },
        { $unwind: { path: "$courses", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            name: { $first: "$name" },
            name_en: { $first: "$name_en" },
            sectors: { $first: "$sectors" },
            code: { $first: "$code" },
            _id: {
              apply_majors: "$_id",
              user_departments: "$courses.students.create_by.user_departments",
              create_by_schools: "$courses.students.create_by.schools",
            },
            total_student: {
              $sum: {
                $cond: [{ $ifNull: ["$courses.students", false] }, 1, 0],
              },
            },
            total_female: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$courses.students.gender",
                      EnumConstant.Gender.FEMALE,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            has_id_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students.poor_id", false] },
                  1,
                  0,
                ],
              },
            },
            has_id_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                      { $ifNull: ["$courses.students.poor_id", false] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            self_apply_student: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students", false] },
                  {
                    $cond: [
                      { $ifNull: ["$courses.students.create_by", false] },
                      0,
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            self_apply_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students.create_by", false] },
                  0,
                  {
                    $cond: [
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: "$_id.apply_majors",
            name: { $first: "$name" },
            name_en: { $first: "$name_en" },
            code: { $first: "$code" },
            sectors: { $first: "$sectors" },
            total_student: { $sum: "$total_student" },
            total_female: { $sum: "$total_female" },
            has_id_poor: { $sum: "$has_id_poor" },
            has_id_poor_female: { $sum: "$has_id_poor_female" },
            self_apply_student: { $sum: "$self_apply_student" },
            self_apply_female: { $sum: "$self_apply_female" },
            user_departments: {
              $push: {
                $cond: [
                  { $ifNull: ["$_id.user_departments", false] },
                  {
                    user_departments: "$_id.user_departments",
                    total_student: "$total_student",
                    total_female: "$total_female",
                  },
                  "$$REMOVE",
                ],
              },
            },
            school_apply_student: {
              $sum: {
                $cond: [
                  { $ifNull: ["$_id.create_by_schools", false] },
                  "$total_student",
                  0,
                ],
              },
            },
            school_apply_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$_id.create_by_schools", false] },
                  "$total_female",
                  0,
                ],
              },
            },
          },
        },
        { $sort: { code: 1 } },
        {
          $group: {
            _id: "$sectors",
            apply_majors: { $push: "$$ROOT" },
            total_student: { $sum: "$total_student" },
            total_female: { $sum: "$total_female" },
            has_id_poor: { $sum: "$has_id_poor" },
            has_id_poor_female: { $sum: "$has_id_poor_female" },
            self_apply_student: { $sum: "$self_apply_student" },
            self_apply_female: { $sum: "$self_apply_female" },
            school_apply_student: { $sum: "$school_apply_student" },
            school_apply_female: { $sum: "$school_apply_female" },
          },
        },
        {
          $lookup: {
            from: "sectors",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "sectors",
          },
        },
        {
          $unwind: { path: "$sectors", preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            name: "$sectors.name",
            name_en: "$sectors.name_en",
            code: "$sectors.code",
          },
        },
        { $sort: { code: 1 } },
        {
          $project: {
            sectors: 0,
          },
        },
      ])
      .allowDiskUse(true);
    // return data
    let groupDeparts: any = [];
    for (var i = 0; i < data.length; i++) {
      for (var major = 0; major < data[i].apply_majors.length; major++) {
        data[i].apply_majors[major].user_departments.forEach((item: any) => {
          groupDeparts.push(String(item.user_departments));
        });
      }
    }
    let getDeparts = await controllers.userDepartment.getManyNoCount({
      query: {
        _id: { $in: groupDeparts },
        status: { $ne: EnumConstant.DELETE },
      },
      select: "name name_en",
    });
    let headerColumns: any = [];
    headerColumns.push({ _id: 1, name: "ដោយខ្លួនឯង" });
    headerColumns.push({ _id: 2, name: "គ្រឹស្ថានសិក្សា" });
    headerColumns.push(...getDeparts);
    headerColumns.push({ _id: 3, name: "មានបណ្ឌសមធម៌" });
    headerColumns.push({ _id: 4, name: "សរុបរួម" });
    let jsonData = CommonUtil.JSONParse(data);
    let keyToRemove = [
      "has_id_poor",
      "has_id_poor_female",
      "self_apply_student",
      "self_apply_female",
      "school_apply_student",
      "school_apply_female",
      "user_departments",
      "total_student",
      "total_female",
    ];
    for (var i = 0; i < jsonData.length; i++) {
      let cityData: any = [];
      cityData.push({
        _id: 1,
        total_student: jsonData[i].self_apply_student,
        total_female: jsonData[i].self_apply_female,
      });
      cityData.push({
        _id: 2,
        total_student: jsonData[i].school_apply_student,
        total_female: jsonData[i].school_apply_female,
      });
      let cityUserDeparts: any = CommonUtil.JSONParse(getDeparts);
      for (var city = 0; city < cityUserDeparts.length; city++) {
        cityUserDeparts[city].total_student = 0;
        cityUserDeparts[city].total_female = 0;
      }
      for (var major = 0; major < jsonData[i].apply_majors.length; major++) {
        let item: any = jsonData[i].apply_majors[major];
        let schoolData: any = [];
        schoolData.push({
          _id: 1,
          total_student: item.self_apply_student,
          total_female: item.self_apply_female,
        });
        schoolData.push({
          _id: 2,
          total_student: item.school_apply_student,
          total_female: item.school_apply_female,
        });
        for (var dep = 0; dep < getDeparts.length; dep++) {
          let exist = false;
          let getDept = getDeparts[dep];
          for (
            var depart = 0;
            depart < item.user_departments.length;
            depart++
          ) {
            if (
              String(item.user_departments[depart].user_departments) ==
              String(getDept._id)
            ) {
              schoolData.push({
                _id: item.user_departments[depart].user_departments,
                total_student: item.user_departments[depart].total_student,
                total_female: item.user_departments[depart].total_female,
              });
              cityUserDeparts[dep].total_student +=
                item.user_departments[depart].total_student;
              cityUserDeparts[dep].total_female +=
                item.user_departments[depart].total_female;
              exist = true;
              break;
            }
          }
          if (!exist) {
            schoolData.push({
              _id: getDept._id,
              total_student: 0,
              total_female: 0,
            });
          }
        }
        schoolData.push({
          _id: 3,
          total_student: item.has_id_poor,
          total_female: item.has_id_poor_female,
        });
        schoolData.push({
          _id: 4,
          total_student: item.total_student,
          total_female: item.total_female,
        });
        jsonData[i].apply_majors[major].student_data = schoolData;
        jsonData[i].apply_majors[major] = CommonUtil.removeKeys(
          jsonData[i].apply_majors[major],
          keyToRemove
        );
      }
      cityData.push(...cityUserDeparts);
      cityData.push({
        _id: 3,
        total_student: jsonData[i].has_id_poor,
        total_female: jsonData[i].has_id_poor_female,
      });
      cityData.push({
        _id: 4,
        total_student: jsonData[i].total_student,
        total_female: jsonData[i].total_female,
      });
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
      jsonData[i].student_data = cityData;
    }
    return {
      start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async approvalStudentCount(req: any) {
    let { apply_majors, shifts, schools, type_poverty_status } = req.query;
    let querySchool: any = {
      status: EnumConstant.ACTIVE,
    };
    if (schools) {
      querySchool._id = new ObjectId(schools);
    }
    if (req.body._user.schools) {
      querySchool._id = new ObjectId(req.body._user.schools);
    }
    let queryCourse: any = {
      status: { $ne: EnumConstant.DELETE },
    };
    if (apply_majors) {
      queryCourse.apply_majors = apply_majors;
    }
    if (shifts) {
      queryCourse.shifts = shifts;
    }
    let matchStudentCourse: any = {};
    if (apply_majors || shifts) {
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchStudentCourse.courses = { $in: getCourses.map((item) => item._id) };
    }
    let matchPoor: any = {};
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );
    let data = await models.school
      .aggregate([
        {
          $match: querySchool,
        },
        {
          $lookup: {
            from: "students",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$schools", "$$id"] },
                  ...matchStudentCourse,
                  ...matchPoor,
                },
              },
              {
                $lookup: {
                  from: "request_timelines",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$students", "$$id"] },
                        $or: [
                          {
                            status: {
                              $in: [
                                EnumConstant.REQUESTING,
                                EnumConstant.ACTIVE,
                              ],
                            },
                            timeline_type:
                              EnumConstant.TimelineType.SCHOLARSHIP,
                            resubmit: { $ne: EnumConstant.ACTIVE },
                          },
                          {
                            status: EnumConstant.ACTIVE,
                            timeline_type:
                              EnumConstant.TimelineType.APPROVALINFO,
                          },
                          {
                            status: EnumConstant.ACTIVE,
                            timeline_type: EnumConstant.TimelineType.IDPOOR,
                          },
                          {
                            status: EnumConstant.REQUESTING,
                            timeline_type: EnumConstant.TimelineType.IDPOOR,
                            resubmit: { $ne: EnumConstant.ACTIVE },
                          },
                        ],
                        createdAt: { $gte: startDate, $lte: endDate },
                      },
                    },
                    {
                      $group: {
                        _id: {
                          status: "$status",
                          timeline_type: "$timeline_type",
                        },
                      },
                    },
                  ],
                  as: "request_timelines",
                },
              },
              { $unwind: { path: "$request_timelines" } },
              {
                $group: {
                  _id: null,
                  apply_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  apply_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  scholarship_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  scholarship_approved_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_request_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_request_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_approved_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                            {
                              $eq: [
                                "$request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  info_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $eq: [
                            "$request_timelines._id.timeline_type",
                            EnumConstant.TimelineType.APPROVALINFO,
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  info_approved_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.APPROVALINFO,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
              {
                $project: { _id: 0 },
              },
            ],
            as: "student_data",
          },
        },
        {
          $unwind: { path: "$student_data", preserveNullAndEmptyArrays: true },
        },
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                {
                  _id: "$_id",
                  name: "$name",
                  name_en: "$name_en",
                  address: "$address",
                  profile_image: "$profile_image",
                  code: "$code",
                  id_code: "$id_code",
                },
                "$student_data",
              ],
            },
          },
        },
        {
          $addFields: {
            apply_female: {
              $cond: [
                { $ifNull: ["$apply_female", false] },
                "$apply_female",
                0,
              ],
            },
            apply_student: {
              $cond: [
                { $ifNull: ["$apply_student", false] },
                "$apply_student",
                0,
              ],
            },
            idpoor_approved_female: {
              $cond: [
                { $ifNull: ["$idpoor_approved_female", false] },
                "$idpoor_approved_female",
                0,
              ],
            },
            idpoor_approved_student: {
              $cond: [
                { $ifNull: ["$idpoor_approved_student", false] },
                "$idpoor_approved_student",
                0,
              ],
            },
            idpoor_request_student: {
              $cond: [
                { $ifNull: ["$idpoor_request_student", false] },
                "$idpoor_request_student",
                0,
              ],
            },
            idpoor_request_female: {
              $cond: [
                { $ifNull: ["$idpoor_request_female", false] },
                "$idpoor_request_female",
                0,
              ],
            },
            info_approved_female: {
              $cond: [
                { $ifNull: ["$info_approved_female", false] },
                "$info_approved_female",
                0,
              ],
            },
            info_approved_student: {
              $cond: [
                { $ifNull: ["$info_approved_student", false] },
                "$info_approved_student",
                0,
              ],
            },
            scholarship_approved_female: {
              $cond: [
                { $ifNull: ["$scholarship_approved_female", false] },
                "$scholarship_approved_female",
                0,
              ],
            },
            scholarship_approved_student: {
              $cond: [
                { $ifNull: ["$scholarship_approved_student", false] },
                "$scholarship_approved_student",
                0,
              ],
            },
          },
        },
        {
          $sort: {
            id_code: 1,
          },
        },
        {
          $group: {
            _id: "$address.city_provinces",
            schools: { $push: "$$ROOT" },
            apply_student: { $sum: "$apply_student" },
            apply_female: { $sum: "$apply_female" },
            scholarship_approved_student: {
              $sum: "$scholarship_approved_student",
            },
            scholarship_approved_female: {
              $sum: "$scholarship_approved_female",
            },
            idpoor_approved_student: { $sum: "$idpoor_approved_student" },
            idpoor_approved_female: { $sum: "$idpoor_approved_female" },
            info_approved_student: { $sum: "$info_approved_student" },
            info_approved_female: { $sum: "$info_approved_female" },
            idpoor_request_student: { $sum: "$idpoor_request_student" },
            idpoor_request_female: { $sum: "$idpoor_request_female" },
          },
        },
        {
          $lookup: {
            from: "city_provinces",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "city_provinces",
          },
        },
        {
          $unwind: {
            path: "$city_provinces",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            name: "$city_provinces.name",
            name_en: "$city_provinces.name_en",
          },
        },
        {
          $sort: {
            "city_provinces.order": 1,
          },
        },
        {
          $project: {
            city_provinces: 0,
            "schools.address": 0,
          },
        },
      ])
      .allowDiskUse(true);

    let keyToRemove = [
      "scholarship_approved_student",
      "scholarship_approved_female",
      "apply_student",
      "apply_female",
      "idpoor_approved_student",
      "idpoor_approved_female",
      "info_approved_student",
      "info_approved_female",
    ];
    let jsonData = CommonUtil.JSONParse(data);
    let headerColumns: any[] = [];
    headerColumns.push({ _id: 1, name: "ចំនួនស្នើសុំចុះឈ្មោះចូលរៀន" });
    headerColumns.push({ _id: 2, name: "អនុម័តដោយគ្រឹះស្ថាន" });
    headerColumns.push({ _id: 3, name: "សំណើទៅមូលនិធិជាតិជំនួយសង្គម" });
    headerColumns.push({ _id: 4, name: "អនុម័តដោយមូលនិធិជាតិជំនួយសង្គម" });
    for (var i = 0; i < jsonData.length; i++) {
      for (var school = 0; school < jsonData[i].schools.length; school++) {
        let studentData: any[] = [];
        let sch = jsonData[i].schools[school];
        studentData.push({
          _id: 1,
          total_student: sch.apply_student,
          total_female: sch.apply_female,
        });
        studentData.push({
          _id: 2,
          total_student: sch.scholarship_approved_student,
          total_female: sch.scholarship_approved_female,
        });
        // studentData.push({ _id: 3, total_student: sch.info_approved_student, total_female: sch.info_approved_female });
        studentData.push({
          _id: 3,
          total_student: sch.idpoor_request_student,
          total_female: sch.idpoor_request_female,
        });
        studentData.push({
          _id: 4,
          total_student: sch.idpoor_approved_student,
          total_female: sch.idpoor_approved_female,
        });
        jsonData[i].schools[school].student_data = studentData;
        jsonData[i].schools[school] = CommonUtil.removeKeys(
          jsonData[i].schools[school],
          keyToRemove
        );
      }
      let studentData: any[] = [];
      let city = jsonData[i];
      studentData.push({
        _id: 1,
        total_student: city.apply_student,
        total_female: city.apply_female,
      });
      studentData.push({
        _id: 2,
        total_student: city.scholarship_approved_student,
        total_female: city.scholarship_approved_female,
      });
      studentData.push({
        _id: 3,
        total_student: city.idpoor_request_student,
        total_female: city.idpoor_request_female,
      });
      studentData.push({
        _id: 4,
        total_student: city.idpoor_approved_student,
        total_female: city.idpoor_approved_female,
      });
      jsonData[i].student_data = studentData;
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
    }
    return {
      start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async approvalStudentByMajor(req: any) {
    let { apply_majors, shifts, schools, type_poverty_status } = req.query;
    if (req.body._user.schools) {
      schools = req.body._user.schools;
    }
    let queryMajor: any = {
      status: EnumConstant.ACTIVE,
      type_projects: EnumConstant.TypeProject.scholarship,
    };
    if (apply_majors) {
      queryMajor._id = new ObjectId(apply_majors);
    }
    let matchCourse: any = {};
    if (shifts || schools) {
      let queryCourse: any = {
        status: { $ne: EnumConstant.DELETE },
      };
      if (shifts) {
        queryCourse.shifts = shifts;
      }
      if (schools) {
        queryCourse.schools = new ObjectId(schools);
      }
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchCourse._id = { $in: getCourses.map((item) => item._id) };
    }
    let matchPoor: any = {};
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );
    let data = await models.applyMajor
      .aggregate([
        {
          $match: queryMajor,
        },
        {
          $lookup: {
            from: "courses",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$apply_majors", "$$id"] },
                  // status: { $ne: EnumConstant.DELETE },
                  ...matchCourse,
                },
              },
              {
                $lookup: {
                  from: "students",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$courses", "$$id"] },
                        ...matchPoor,
                      },
                    },
                    {
                      $lookup: {
                        from: "request_timelines",
                        let: { id: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$students", "$$id"] },
                              $or: [
                                {
                                  status: {
                                    $in: [
                                      EnumConstant.REQUESTING,
                                      EnumConstant.ACTIVE,
                                    ],
                                  },
                                  timeline_type:
                                    EnumConstant.TimelineType.SCHOLARSHIP,
                                  resubmit: { $ne: EnumConstant.ACTIVE },
                                },
                                {
                                  status: EnumConstant.ACTIVE,
                                  timeline_type:
                                    EnumConstant.TimelineType.APPROVALINFO,
                                },
                                {
                                  status: EnumConstant.ACTIVE,
                                  timeline_type:
                                    EnumConstant.TimelineType.IDPOOR,
                                },
                                {
                                  status: EnumConstant.REQUESTING,
                                  timeline_type:
                                    EnumConstant.TimelineType.IDPOOR,
                                  resubmit: { $ne: EnumConstant.ACTIVE },
                                },
                              ],
                              createdAt: { $gte: startDate, $lte: endDate },
                            },
                          },
                          {
                            $group: {
                              _id: {
                                status: "$status",
                                timeline_type: "$timeline_type",
                              },
                            },
                          },
                        ],
                        as: "request_timelines",
                      },
                    },
                    { $unwind: { path: "$request_timelines" } },
                  ],
                  as: "students",
                },
              },
              { $unwind: { path: "$students" } },
            ],
            as: "courses",
          },
        },
        { $unwind: { path: "$courses", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$_id",
            name: { $first: "$name" },
            name_en: { $first: "$name_en" },
            sectors: { $first: "$sectors" },
            code: { $first: "$code" },
            apply_student: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.SCHOLARSHIP,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            apply_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.SCHOLARSHIP,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            scholarship_approved_student: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.SCHOLARSHIP,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            scholarship_approved_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.SCHOLARSHIP,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            idpoor_request_student: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.IDPOOR,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            idpoor_request_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.IDPOOR,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            idpoor_approved_student: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.IDPOOR,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            idpoor_approved_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.IDPOOR,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            info_approved_student: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$courses.students.request_timelines._id.timeline_type",
                      EnumConstant.TimelineType.APPROVALINFO,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            info_approved_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id.timeline_type",
                          EnumConstant.TimelineType.APPROVALINFO,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $addFields: {
            apply_female: {
              $cond: [
                { $ifNull: ["$apply_female", false] },
                "$apply_female",
                0,
              ],
            },
            apply_student: {
              $cond: [
                { $ifNull: ["$apply_student", false] },
                "$apply_student",
                0,
              ],
            },
            idpoor_approved_female: {
              $cond: [
                { $ifNull: ["$idpoor_approved_female", false] },
                "$idpoor_approved_female",
                0,
              ],
            },
            idpoor_approved_student: {
              $cond: [
                { $ifNull: ["$idpoor_approved_student", false] },
                "$idpoor_approved_student",
                0,
              ],
            },
            idpoor_request_student: {
              $cond: [
                { $ifNull: ["$idpoor_request_student", false] },
                "$idpoor_request_student",
                0,
              ],
            },
            idpoor_request_female: {
              $cond: [
                { $ifNull: ["$idpoor_request_female", false] },
                "$idpoor_request_female",
                0,
              ],
            },
            info_approved_female: {
              $cond: [
                { $ifNull: ["$info_approved_female", false] },
                "$info_approved_female",
                0,
              ],
            },
            info_approved_student: {
              $cond: [
                { $ifNull: ["$info_approved_student", false] },
                "$info_approved_student",
                0,
              ],
            },
            scholarship_approved_female: {
              $cond: [
                { $ifNull: ["$scholarship_approved_female", false] },
                "$scholarship_approved_female",
                0,
              ],
            },
            scholarship_approved_student: {
              $cond: [
                { $ifNull: ["$scholarship_approved_student", false] },
                "$scholarship_approved_student",
                0,
              ],
            },
          },
        },
        { $sort: { code: 1 } },
        {
          $group: {
            _id: "$sectors",
            apply_majors: { $push: "$$ROOT" },
            apply_student: { $sum: "$apply_student" },
            apply_female: { $sum: "$apply_female" },
            scholarship_approved_student: {
              $sum: "$scholarship_approved_student",
            },
            scholarship_approved_female: {
              $sum: "$scholarship_approved_female",
            },
            idpoor_approved_student: { $sum: "$idpoor_approved_student" },
            idpoor_approved_female: { $sum: "$idpoor_approved_female" },
            info_approved_student: { $sum: "$info_approved_student" },
            info_approved_female: { $sum: "$info_approved_female" },
            idpoor_request_student: { $sum: "$idpoor_request_student" },
            idpoor_request_female: { $sum: "$idpoor_request_female" },
          },
        },
        {
          $lookup: {
            from: "sectors",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "sectors",
          },
        },
        {
          $unwind: { path: "$sectors", preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            name: "$sectors.name",
            name_en: "$sectors.name_en",
            code: "$sectors.code",
          },
        },
        {
          $sort: {
            code: 1,
          },
        },
        {
          $project: {
            sectors: 0,
          },
        },
      ])
      .allowDiskUse(true);
    let keyToRemove = [
      "scholarship_approved_student",
      "scholarship_approved_female",
      "apply_student",
      "apply_female",
      "idpoor_approved_student",
      "idpoor_approved_female",
      "info_approved_student",
      "info_approved_female",
      "idpoor_request_female",
      "idpoor_request_student",
    ];
    let jsonData = CommonUtil.JSONParse(data);
    let headerColumns: any[] = [];
    headerColumns.push({ _id: 1, name: "ចំនួនស្នើសុំចុះឈ្មោះចូលរៀន" });
    headerColumns.push({ _id: 2, name: "អនុម័តដោយគ្រឹះស្ថាន" });
    // headerColumns.push({_id: 3, name: "អនុម័តដោយអគ្គនាយកដ្ឋាន"})
    headerColumns.push({ _id: 3, name: "សំណើទៅមូលនិធិជាតិជំនួយសង្គម" });
    headerColumns.push({ _id: 4, name: "អនុម័តដោយមូលនិធិជាតិជំនួយសង្គម" });
    for (var i = 0; i < jsonData.length; i++) {
      for (var major = 0; major < jsonData[i].apply_majors.length; major++) {
        let studentData: any[] = [];
        let sch = jsonData[i].apply_majors[major];
        studentData.push({
          _id: 1,
          total_student: sch.apply_student,
          total_female: sch.apply_female,
        });
        studentData.push({
          _id: 2,
          total_student: sch.scholarship_approved_student,
          total_female: sch.scholarship_approved_female,
        });
        studentData.push({
          _id: 3,
          total_student: sch.idpoor_request_student,
          total_female: sch.idpoor_request_female,
        });
        studentData.push({
          _id: 4,
          total_student: sch.idpoor_approved_student,
          total_female: sch.idpoor_approved_female,
        });
        jsonData[i].apply_majors[major].student_data = studentData;
        jsonData[i].apply_majors[major] = CommonUtil.removeKeys(
          jsonData[i].apply_majors[major],
          keyToRemove
        );
      }
      let studentData: any[] = [];
      let city = jsonData[i];
      studentData.push({
        _id: 1,
        total_student: city.apply_student,
        total_female: city.apply_female,
      });
      studentData.push({
        _id: 2,
        total_student: city.scholarship_approved_student,
        total_female: city.scholarship_approved_female,
      });
      studentData.push({
        _id: 3,
        total_student: city.idpoor_request_student,
        total_female: city.idpoor_request_female,
      });
      studentData.push({
        _id: 4,
        total_student: city.idpoor_approved_student,
        total_female: city.idpoor_approved_female,
      });
      jsonData[i].student_data = studentData;
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
    }
    return {
      start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }
  async approvalStudentByCityProvince(req: any) {
    let { apply_majors, shifts, schools, type_poverty_status } = req.query;
    let querySchool: any = {
      status: EnumConstant.ACTIVE,
    };
    if (schools) {
      querySchool._id = new ObjectId(schools);
    }
    if (req.body._user.schools) {
      querySchool._id = new ObjectId(req.body._user.schools);
    }
    let matchCourse: any = {};
    if (shifts || apply_majors) {
      let queryCourse: any = {
        status: { $ne: EnumConstant.DELETE },
      };
      if (shifts) {
        queryCourse.shifts = shifts;
      }
      if (apply_majors) {
        queryCourse.apply_majors = new ObjectId(apply_majors);
      }
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchCourse._id = { $in: getCourses.map((item) => item._id) };
    }
    let matchPoor: any = {};
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );
    let data = await models.school
      .aggregate([
        {
          $match: querySchool,
        },
        {
          $lookup: {
            from: "skills",
            let: { schoolId: "$_id" },
            pipeline: [
              {
                $match: {
                  status: EnumConstant.ACTIVE,
                },
              },
              {
                $lookup: {
                  from: "courses",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ["$apply_majors", "$$id"] },
                            { $eq: ["$schools", "$$schoolId"] },
                          ],
                        },
                        // status: { $ne: EnumConstant.DELETE },
                        ...matchCourse,
                      },
                    },
                    {
                      $lookup: {
                        from: "students",
                        let: { id: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$courses", "$$id"] },
                              ...matchPoor,
                            },
                          },
                          {
                            $lookup: {
                              from: "request_timelines",
                              let: { id: "$_id" },
                              pipeline: [
                                {
                                  $match: {
                                    $expr: { $eq: ["$students", "$$id"] },
                                    $or: [
                                      {
                                        status: {
                                          $in: [
                                            EnumConstant.REQUESTING,
                                            EnumConstant.ACTIVE,
                                          ],
                                        },
                                        timeline_type:
                                          EnumConstant.TimelineType.SCHOLARSHIP,
                                        resubmit: { $ne: EnumConstant.ACTIVE },
                                      },
                                      {
                                        status: EnumConstant.ACTIVE,
                                        timeline_type:
                                          EnumConstant.TimelineType
                                            .APPROVALINFO,
                                      },
                                      {
                                        status: EnumConstant.ACTIVE,
                                        timeline_type:
                                          EnumConstant.TimelineType.IDPOOR,
                                      },
                                      {
                                        status: EnumConstant.REQUESTING,
                                        timeline_type:
                                          EnumConstant.TimelineType.IDPOOR,
                                        resubmit: { $ne: EnumConstant.ACTIVE },
                                      },
                                    ],
                                    createdAt: {
                                      $gte: startDate,
                                      $lte: endDate,
                                    },
                                  },
                                },
                                {
                                  $group: {
                                    _id: {
                                      status: "$status",
                                      timeline_type: "$timeline_type",
                                    },
                                  },
                                },
                              ],
                              as: "request_timelines",
                            },
                          },
                          { $unwind: { path: "$request_timelines" } },
                        ],
                        as: "students",
                      },
                    },
                    { $unwind: { path: "$students" } },
                  ],
                  as: "courses",
                },
              },
              {
                $unwind: { path: "$courses", preserveNullAndEmptyArrays: true },
              },
              {
                $group: {
                  _id: "$_id",
                  name: { $first: "$name" },
                  name_en: { $first: "$name_en" },
                  sectors: { $first: "$sectors" },
                  code: { $first: "$code" },
                  apply_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  apply_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.gender",
                                EnumConstant.Gender.FEMALE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  scholarship_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  scholarship_approved_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.SCHOLARSHIP,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.gender",
                                EnumConstant.Gender.FEMALE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_request_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_request_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.REQUESTING,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.gender",
                                EnumConstant.Gender.FEMALE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  idpoor_approved_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.IDPOOR,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.gender",
                                EnumConstant.Gender.FEMALE,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.status",
                                EnumConstant.ACTIVE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  info_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $eq: [
                            "$courses.students.request_timelines._id.timeline_type",
                            EnumConstant.TimelineType.APPROVALINFO,
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  info_approved_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$courses.students.request_timelines._id.timeline_type",
                                EnumConstant.TimelineType.APPROVALINFO,
                              ],
                            },
                            {
                              $eq: [
                                "$courses.students.gender",
                                EnumConstant.Gender.FEMALE,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
              {
                $addFields: {
                  apply_female: {
                    $cond: [
                      { $ifNull: ["$apply_female", false] },
                      "$apply_female",
                      0,
                    ],
                  },
                  apply_student: {
                    $cond: [
                      { $ifNull: ["$apply_student", false] },
                      "$apply_student",
                      0,
                    ],
                  },
                  idpoor_approved_female: {
                    $cond: [
                      { $ifNull: ["$idpoor_approved_female", false] },
                      "$idpoor_approved_female",
                      0,
                    ],
                  },
                  idpoor_approved_student: {
                    $cond: [
                      { $ifNull: ["$idpoor_approved_student", false] },
                      "$idpoor_approved_student",
                      0,
                    ],
                  },
                  idpoor_request_student: {
                    $cond: [
                      { $ifNull: ["$idpoor_request_student", false] },
                      "$idpoor_request_student",
                      0,
                    ],
                  },
                  idpoor_request_female: {
                    $cond: [
                      { $ifNull: ["$idpoor_request_female", false] },
                      "$idpoor_request_female",
                      0,
                    ],
                  },
                  info_approved_female: {
                    $cond: [
                      { $ifNull: ["$info_approved_female", false] },
                      "$info_approved_female",
                      0,
                    ],
                  },
                  info_approved_student: {
                    $cond: [
                      { $ifNull: ["$info_approved_student", false] },
                      "$info_approved_student",
                      0,
                    ],
                  },
                  scholarship_approved_female: {
                    $cond: [
                      { $ifNull: ["$scholarship_approved_female", false] },
                      "$scholarship_approved_female",
                      0,
                    ],
                  },
                  scholarship_approved_student: {
                    $cond: [
                      { $ifNull: ["$scholarship_approved_student", false] },
                      "$scholarship_approved_student",
                      0,
                    ],
                  },
                },
              },
              { $sort: { code: 1 } },
              {
                $group: {
                  _id: "$sectors",
                  apply_majors: { $push: "$$ROOT" },
                  apply_student: { $sum: "$apply_student" },
                  apply_female: { $sum: "$apply_female" },
                  scholarship_approved_student: {
                    $sum: "$scholarship_approved_student",
                  },
                  scholarship_approved_female: {
                    $sum: "$scholarship_approved_female",
                  },
                  idpoor_approved_student: { $sum: "$idpoor_approved_student" },
                  idpoor_approved_female: { $sum: "$idpoor_approved_female" },
                  info_approved_student: { $sum: "$info_approved_student" },
                  info_approved_female: { $sum: "$info_approved_female" },
                  idpoor_request_student: { $sum: "$idpoor_request_student" },
                  idpoor_request_female: { $sum: "$idpoor_request_female" },
                },
              },
              {
                $lookup: {
                  from: "sectors",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$id"] },
                      },
                    },
                  ],
                  as: "sectors",
                },
              },
              {
                $unwind: { path: "$sectors", preserveNullAndEmptyArrays: true },
              },
              {
                $addFields: {
                  name: "$sectors.name",
                  name_en: "$sectors.name_en",
                  code: "$sectors.code",
                },
              },
              {
                $project: {
                  sectors: 0,
                },
              },
            ],
            as: "sectors",
          },
        },
        {
          $unwind: { path: "$sectors" },
        },
        { $sort: { "sectors.code": 1 } },
        {
          $group: {
            _id: "$_id",
            address: { $first: "$address" },
            name: { $first: "$name" },
            name_en: { $first: "$name_en" },
            profile_image: { $first: "$profile_image" },
            id_code: { $first: "$id_code" },
            code_en: { $first: "$code_en" },
            sectors: { $push: "$sectors" },
            apply_student: { $sum: "$sectors.apply_student" },
            apply_female: { $sum: "$sectors.apply_female" },
            scholarship_approved_student: {
              $sum: "$sectors.scholarship_approved_student",
            },
            scholarship_approved_female: {
              $sum: "$sectors.scholarship_approved_female",
            },
            idpoor_approved_student: {
              $sum: "$sectors.idpoor_approved_student",
            },
            idpoor_approved_female: { $sum: "$sectors.idpoor_approved_female" },
            info_approved_student: { $sum: "$sectors.info_approved_student" },
            info_approved_female: { $sum: "$sectors.info_approved_female" },
            idpoor_request_student: { $sum: "$sectors.idpoor_request_student" },
            idpoor_request_female: { $sum: "$sectors.idpoor_request_female" },
          },
        },
        {
          $sort: {
            id_code: 1,
          },
        },
        {
          $group: {
            _id: "$address.city_provinces",
            schools: { $push: "$$ROOT" },
            apply_student: { $sum: "$apply_student" },
            apply_female: { $sum: "$apply_female" },
            scholarship_approved_student: {
              $sum: "$scholarship_approved_student",
            },
            scholarship_approved_female: {
              $sum: "$scholarship_approved_female",
            },
            idpoor_approved_student: { $sum: "$idpoor_approved_student" },
            idpoor_approved_female: { $sum: "$idpoor_approved_female" },
            info_approved_student: { $sum: "$info_approved_student" },
            info_approved_female: { $sum: "$info_approved_female" },
            idpoor_request_student: { $sum: "$idpoor_request_student" },
            idpoor_request_female: { $sum: "$idpoor_request_female" },
          },
        },
        {
          $lookup: {
            from: "city_provinces",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "city_provinces",
          },
        },
        {
          $unwind: {
            path: "$city_provinces",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: {
            "city_provinces.order": 1,
          },
        },
        {
          $addFields: {
            name: "$city_provinces.name",
            name_en: "$city_provinces.name_en",
          },
        },
        {
          $project: {
            city_provinces: 0,
            "schools.address": 0,
          },
        },
      ])
      .allowDiskUse(true);
    let jsonData = CommonUtil.JSONParse(data);
    let headerColumns: any[] = [];
    headerColumns.push({ _id: 1, name: "ចំនួនស្នើសុំចុះឈ្មោះចូលរៀន" });
    headerColumns.push({ _id: 2, name: "អនុម័តដោយគ្រឹះស្ថាន" });
    headerColumns.push({ _id: 3, name: "សំណើទៅមូលនិធិជាតិជំនួយសង្គម" });
    headerColumns.push({ _id: 4, name: "អនុម័តដោយមូលនិធិជាតិជំនួយសង្គម" });
    let keyToRemove = [
      "scholarship_approved_student",
      "scholarship_approved_female",
      "apply_student",
      "apply_female",
      "idpoor_approved_student",
      "idpoor_approved_female",
      "info_approved_student",
      "info_approved_female",
    ];
    for (var i = 0; i < jsonData.length; i++) {
      for (var school = 0; school < jsonData[i].schools.length; school++) {
        let sch = jsonData[i].schools[school];
        for (var sector = 0; sector < sch.sectors.length; sector++) {
          let sec = sch.sectors[sector];
          for (var major = 0; major < sec.apply_majors.length; major++) {
            let studentData: any[] = [];
            let maj = sec.apply_majors[major];
            studentData.push({
              _id: 1,
              total_student: maj.apply_student,
              total_female: maj.apply_female,
            });
            studentData.push({
              _id: 2,
              total_student: maj.scholarship_approved_student,
              total_female: maj.scholarship_approved_female,
            });
            studentData.push({
              _id: 3,
              total_student: maj.idpoor_request_student,
              total_female: maj.idpoor_request_female,
            });
            studentData.push({
              _id: 4,
              total_student: maj.idpoor_approved_student,
              total_female: maj.idpoor_approved_female,
            });
            jsonData[i].schools[school].sectors[sector].apply_majors[
              major
            ].student_data = studentData;
            jsonData[i].schools[school].sectors[sector].apply_majors[major] =
              CommonUtil.removeKeys(
                jsonData[i].schools[school].sectors[sector].apply_majors[major],
                keyToRemove
              );
          }
          let studentData: any[] = [];
          studentData.push({
            _id: 1,
            total_student: sec.apply_student,
            total_female: sec.apply_female,
          });
          studentData.push({
            _id: 2,
            total_student: sec.scholarship_approved_student,
            total_female: sec.scholarship_approved_female,
          });
          studentData.push({
            _id: 3,
            total_student: sec.idpoor_request_student,
            total_female: sec.idpoor_request_female,
          });
          studentData.push({
            _id: 4,
            total_student: sec.idpoor_approved_student,
            total_female: sec.idpoor_approved_female,
          });
          jsonData[i].schools[school].sectors[sector].student_data =
            studentData;
          jsonData[i].schools[school].sectors[sector] = CommonUtil.removeKeys(
            jsonData[i].schools[school].sectors[sector],
            keyToRemove
          );
        }
        let studentData: any[] = [];
        studentData.push({
          _id: 1,
          total_student: sch.apply_student,
          total_female: sch.apply_female,
        });
        studentData.push({
          _id: 2,
          total_student: sch.scholarship_approved_student,
          total_female: sch.scholarship_approved_female,
        });
        studentData.push({
          _id: 3,
          total_student: sch.idpoor_request_student,
          total_female: sch.idpoor_request_female,
        });
        studentData.push({
          _id: 4,
          total_student: sch.idpoor_approved_student,
          total_female: sch.idpoor_approved_female,
        });
        jsonData[i].schools[school].student_data = studentData;
        jsonData[i].schools[school] = CommonUtil.removeKeys(
          jsonData[i].schools[school],
          keyToRemove
        );
      }
      let studentData: any[] = [];
      let city = jsonData[i];
      studentData.push({
        _id: 1,
        total_student: city.apply_student,
        total_female: city.apply_female,
      });
      studentData.push({
        _id: 2,
        total_student: city.scholarship_approved_student,
        total_female: city.scholarship_approved_female,
      });
      studentData.push({
        _id: 3,
        total_student: city.idpoor_request_student,
        total_female: city.idpoor_request_female,
      });
      studentData.push({
        _id: 4,
        total_student: city.idpoor_approved_student,
        total_female: city.idpoor_approved_female,
      });
      jsonData[i].student_data = studentData;
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
    }
    return {
      start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async studentApplyByCityProvince(req: any) {
    let { apply_majors, shifts, schools, type_poverty_status } = req.query;
    let querySchool: any = {
      status: EnumConstant.ACTIVE,
    };
    if (schools) {
      querySchool._id = new ObjectId(schools);
    }
    if (req.body._user.schools) {
      querySchool._id = new ObjectId(req.body._user.schools);
    }
    let matchCourse: any = {};
    if (shifts || apply_majors) {
      let queryCourse: any = {
        status: { $ne: EnumConstant.DELETE },
      };
      if (shifts) {
        queryCourse.shifts = shifts;
      }
      if (apply_majors) {
        queryCourse.apply_majors = new ObjectId(apply_majors);
      }
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchCourse._id = { $in: getCourses.map((item) => item._id) };
    }
    let matchPoor: any = {};
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let [startDate, endDate] = CommonUtil.parseStartDateEndDate(
      req.query.start_date,
      req.query.end_date
    );
    let data = await models.school
      .aggregate([
        {
          $match: querySchool,
        },
        {
          $lookup: {
            from: "skills",
            let: { schoolId: "$_id" },
            pipeline: [
              {
                $match: {
                  status: EnumConstant.ACTIVE,
                },
              },
              {
                $lookup: {
                  from: "courses",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ["$apply_majors", "$$id"] },
                            { $eq: ["$schools", "$$schoolId"] },
                          ],
                        },
                        status: { $ne: EnumConstant.DELETE },
                        ...matchCourse,
                      },
                    },
                    {
                      $lookup: {
                        from: "students",
                        let: { id: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$courses", "$$id"] },
                              ...matchPoor,
                            },
                          },
                          {
                            $lookup: {
                              from: "request_timelines",
                              let: { id: "$_id" },
                              pipeline: [
                                {
                                  $match: {
                                    $expr: { $eq: ["$students", "$$id"] },
                                    status: EnumConstant.REQUESTING,
                                    timeline_type:
                                      EnumConstant.TimelineType.SCHOLARSHIP,
                                    createdAt: {
                                      $gte: startDate,
                                      $lte: endDate,
                                    },
                                    resubmit: { $ne: EnumConstant.ACTIVE },
                                  },
                                },
                                {
                                  $limit: 1,
                                },
                              ],
                              as: "request_timelines",
                            },
                          },
                          { $unwind: { path: "$request_timelines" } },
                          {
                            $lookup: {
                              from: "staffs",
                              let: { id: "$create_by" },
                              pipeline: [
                                {
                                  $match: {
                                    $expr: { $eq: ["$_id", "$$id"] },
                                  },
                                },
                                {
                                  $project: {
                                    schools: 1,
                                    user_departments: 1,
                                  },
                                },
                              ],
                              as: "create_by",
                            },
                          },
                          {
                            $unwind: {
                              path: "$create_by",
                              preserveNullAndEmptyArrays: true,
                            },
                          },
                        ],
                        as: "students",
                      },
                    },
                    { $unwind: { path: "$students" } },
                  ],
                  as: "courses",
                },
              },
              {
                $unwind: { path: "$courses", preserveNullAndEmptyArrays: true },
              },
              {
                $group: {
                  name: { $first: "$name" },
                  name_en: { $first: "$name_en" },
                  sectors: { $first: "$sectors" },
                  code: { $first: "$code" },
                  _id: {
                    apply_majors: "$_id",
                    user_departments:
                      "$courses.students.create_by.user_departments",
                    create_by_schools: "$courses.students.create_by.schools",
                  },
                  total_student: {
                    $sum: {
                      $cond: [{ $ifNull: ["$courses.students", false] }, 1, 0],
                    },
                  },
                  total_female: {
                    $sum: {
                      $cond: [
                        {
                          $eq: [
                            "$courses.students.gender",
                            EnumConstant.Gender.FEMALE,
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  self_apply_student: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$courses.students", false] },
                        {
                          $cond: [
                            { $ifNull: ["$courses.students.create_by", false] },
                            0,
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  self_apply_female: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$courses.students.create_by", false] },
                        0,
                        {
                          $cond: [
                            {
                              $eq: [
                                "$courses.students.gender",
                                EnumConstant.Gender.FEMALE,
                              ],
                            },
                            1,
                            0,
                          ],
                        },
                      ],
                    },
                  },
                },
              },
              {
                $group: {
                  _id: "$_id.apply_majors",
                  name: { $first: "$name" },
                  name_en: { $first: "$name_en" },
                  sectors: { $first: "$sectors" },
                  code: { $first: "$code" },
                  total_student: { $sum: "$total_student" },
                  total_female: { $sum: "$total_female" },
                  self_apply_student: { $sum: "$self_apply_student" },
                  self_apply_female: { $sum: "$self_apply_female" },
                  user_departments: {
                    $push: {
                      $cond: [
                        { $ifNull: ["$_id.user_departments", false] },
                        {
                          user_departments: "$_id.user_departments",
                          total_student: "$total_student",
                          total_female: "$total_female",
                        },
                        "$$REMOVE",
                      ],
                    },
                  },
                  school_apply_student: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$_id.create_by_schools", false] },
                        "$total_student",
                        0,
                      ],
                    },
                  },
                  school_apply_female: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$_id.create_by_schools", false] },
                        "$total_female",
                        0,
                      ],
                    },
                  },
                },
              },
              { $sort: { code: 1 } },
              {
                $group: {
                  _id: "$sectors",
                  apply_majors: { $push: "$$ROOT" },
                  total_student: { $sum: "$total_student" },
                  total_female: { $sum: "$total_female" },
                  self_apply_student: { $sum: "$self_apply_student" },
                  self_apply_female: { $sum: "$self_apply_female" },
                  school_apply_student: { $sum: "$school_apply_student" },
                  school_apply_female: { $sum: "$school_apply_female" },
                },
              },
              {
                $lookup: {
                  from: "sectors",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$id"] },
                      },
                    },
                  ],
                  as: "sectors",
                },
              },
              {
                $unwind: { path: "$sectors", preserveNullAndEmptyArrays: true },
              },
              {
                $addFields: {
                  name: "$sectors.name",
                  name_en: "$sectors.name_en",
                  code: "$sectors.code",
                },
              },
              {
                $project: {
                  sectors: 0,
                },
              },
            ],
            as: "sectors",
          },
        },
        {
          $unwind: { path: "$sectors" },
        },
        {
          $sort: {
            "sectors.code": 1,
          },
        },
        {
          $group: {
            _id: "$_id",
            address: { $first: "$address" },
            name: { $first: "$name" },
            name_en: { $first: "$name_en" },
            profile_image: { $first: "$profile_image" },
            id_code: { $first: "$id_code" },
            code_en: { $first: "$code_en" },
            sectors: { $push: "$sectors" },
            total_student: { $sum: "$sectors.total_student" },
            total_female: { $sum: "$sectors.total_female" },
            self_apply_student: { $sum: "$sectors.self_apply_student" },
            self_apply_female: { $sum: "$sectors.self_apply_female" },
            school_apply_student: { $sum: "$sectors.school_apply_student" },
            school_apply_female: { $sum: "$sectors.school_apply_female" },
          },
        },
        {
          $sort: {
            id_code: 1,
          },
        },
        {
          $group: {
            _id: "$address.city_provinces",
            schools: { $push: "$$ROOT" },
            total_student: { $sum: "$total_student" },
            total_female: { $sum: "$total_female" },
            self_apply_student: { $sum: "$self_apply_student" },
            self_apply_female: { $sum: "$self_apply_female" },
            school_apply_student: { $sum: "$school_apply_student" },
            school_apply_female: { $sum: "$school_apply_female" },
          },
        },
        {
          $lookup: {
            from: "city_provinces",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "city_provinces",
          },
        },
        {
          $unwind: {
            path: "$city_provinces",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            name: "$city_provinces.name",
            name_en: "$city_provinces.name_en",
          },
        },
        {
          $sort: {
            "city_provinces.order": 1,
          },
        },
        {
          $project: {
            city_provinces: 0,
            "schools.address": 0,
          },
        },
      ])
      .allowDiskUse(true);
    let groupDeparts: any = [];
    data.forEach((ds) => {
      ds.schools.forEach((schs: any) => {
        schs.sectors.forEach((secs: any) => {
          secs.apply_majors.forEach((maj: any) => {
            maj.user_departments.forEach((item: any) => {
              groupDeparts.push(String(item.user_departments));
            });
          });
        });
      });
    });
    let getDeparts = await controllers.userDepartment.getManyNoCount({
      query: {
        _id: { $in: groupDeparts },
        status: { $ne: EnumConstant.DELETE },
      },
      select: "name name_en",
    });
    let headerColumns: any = [];
    headerColumns.push({ _id: 1, name: "ដោយខ្លួនឯង" });
    headerColumns.push({ _id: 2, name: "គ្រឹស្ថានសិក្សា" });
    headerColumns.push(...getDeparts);
    headerColumns.push({ _id: 3, name: "សរុបរួម" });
    let jsonData = CommonUtil.JSONParse(data);
    let keyToRemove = [
      "self_apply_student",
      "self_apply_female",
      "school_apply_student",
      "school_apply_female",
      "user_departments",
      "total_student",
      "total_female",
    ];
    for (var i = 0; i < jsonData.length; i++) {
      let cityStudentData: any = [];
      cityStudentData.push({
        _id: 1,
        total_student: jsonData[i].self_apply_student,
        total_female: jsonData[i].self_apply_female,
      });
      cityStudentData.push({
        _id: 2,
        total_student: jsonData[i].school_apply_student,
        total_female: jsonData[i].school_apply_female,
      });
      let cityDepartValue: any = CommonUtil.JSONParse(getDeparts);
      for (var dep = 0; dep < getDeparts.length; dep++) {
        cityDepartValue[dep].total_student = 0;
        cityDepartValue[dep].total_female = 0;
      }
      for (var schs = 0; schs < jsonData[i].schools.length; schs++) {
        let schoolItem: any = jsonData[i].schools[schs];
        let schoolStudentData: any = [];
        schoolStudentData.push({
          _id: 1,
          total_student: schoolItem.self_apply_student,
          total_female: schoolItem.self_apply_female,
        });
        schoolStudentData.push({
          _id: 2,
          total_student: schoolItem.school_apply_student,
          total_female: schoolItem.school_apply_female,
        });
        let schoolDepartValue: any = CommonUtil.JSONParse(getDeparts);
        for (var dep = 0; dep < getDeparts.length; dep++) {
          schoolDepartValue[dep].total_student = 0;
          schoolDepartValue[dep].total_female = 0;
        }
        for (var sec = 0; sec < schoolItem.sectors.length; sec++) {
          let sectorItem = schoolItem.sectors[sec];
          let sectorStudentData: any = [];
          let sectorDepartValue: any = CommonUtil.JSONParse(getDeparts);
          for (var dep = 0; dep < getDeparts.length; dep++) {
            sectorDepartValue[dep].total_student = 0;
            sectorDepartValue[dep].total_female = 0;
          }
          sectorStudentData.push({
            _id: 1,
            total_student: sectorItem.self_apply_student,
            total_female: sectorItem.self_apply_female,
          });
          sectorStudentData.push({
            _id: 2,
            total_student: sectorItem.school_apply_student,
            total_female: sectorItem.school_apply_female,
          });
          for (var maj = 0; maj < sectorItem.apply_majors.length; maj++) {
            let majorItem = sectorItem.apply_majors[maj];
            let majorStudentData: any = [];
            majorStudentData.push({
              _id: 1,
              total_student: majorItem.self_apply_student,
              total_female: majorItem.self_apply_female,
            });
            majorStudentData.push({
              _id: 2,
              total_student: majorItem.school_apply_student,
              total_female: majorItem.school_apply_female,
            });
            for (var dep = 0; dep < getDeparts.length; dep++) {
              let exist = false;
              let getDept = getDeparts[dep];
              for (
                var depart = 0;
                depart < majorItem.user_departments.length;
                depart++
              ) {
                if (
                  String(majorItem.user_departments[depart].user_departments) ==
                  String(getDept._id)
                ) {
                  majorStudentData.push({
                    _id: majorItem.user_departments[depart].user_departments,
                    total_student:
                      majorItem.user_departments[depart].total_student,
                    total_female:
                      majorItem.user_departments[depart].total_female,
                  });
                  sectorDepartValue[dep].total_student +=
                    majorItem.user_departments[depart].total_student;
                  sectorDepartValue[dep].total_female +=
                    majorItem.user_departments[depart].total_female;
                  schoolDepartValue[dep].total_student +=
                    majorItem.user_departments[depart].total_student;
                  schoolDepartValue[dep].total_female +=
                    majorItem.user_departments[depart].total_female;
                  cityDepartValue[dep].total_student +=
                    majorItem.user_departments[depart].total_student;
                  cityDepartValue[dep].total_female +=
                    majorItem.user_departments[depart].total_female;
                  exist = true;
                  break;
                }
              }
              if (!exist) {
                majorStudentData.push({
                  _id: getDept._id,
                  total_student: 0,
                  total_female: 0,
                });
              }
            }
            majorStudentData.push({
              _id: 3,
              total_student: majorItem.total_student,
              total_female: majorItem.total_female,
            });
            jsonData[i].schools[schs].sectors[sec].apply_majors[
              maj
            ].student_data = majorStudentData;
            jsonData[i].schools[schs].sectors[sec].apply_majors[maj] =
              CommonUtil.removeKeys(
                jsonData[i].schools[schs].sectors[sec].apply_majors[maj],
                keyToRemove
              );
          }
          sectorStudentData.push(...sectorDepartValue);
          sectorStudentData.push({
            _id: 3,
            total_student: sectorItem.total_student,
            total_female: sectorItem.total_female,
          });
          jsonData[i].schools[schs].sectors[sec].student_data =
            sectorStudentData;
          jsonData[i].schools[schs].sectors[sec] = CommonUtil.removeKeys(
            jsonData[i].schools[schs].sectors[sec],
            keyToRemove
          );
        }
        schoolStudentData.push(...schoolDepartValue);
        schoolStudentData.push({
          _id: 3,
          total_student: schoolItem.total_student,
          total_female: schoolItem.total_female,
        });
        jsonData[i].schools[schs].student_data = schoolStudentData;
        jsonData[i].schools[schs] = CommonUtil.removeKeys(
          jsonData[i].schools[schs],
          keyToRemove
        );
      }
      cityStudentData.push(...cityDepartValue);
      cityStudentData.push({
        _id: 3,
        total_student: jsonData[i].total_student,
        total_female: jsonData[i].total_female,
      });
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
      jsonData[i].student_data = cityStudentData;
    }
    return {
      start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async studentStudyStatusBySchool(req: any) {
    let {
      apply_majors,
      shifts,
      schools,
      poor_id_status,
      type_poverty_status,
      type_scholarship_documents,
    } = req.query;

    let querySchool: any = {
      status: EnumConstant.ACTIVE,
    };
    if (schools) {
      querySchool._id = new ObjectId(schools);
    }
    if (req.body._user.schools) {
      querySchool._id = new ObjectId(req.body._user.schools);
    }
    let matchCourse: any = {};
    let matchCountCourse: any = {};
    if (shifts || apply_majors) {
      let queryCourse: any = {
        status: { $ne: EnumConstant.DELETE },
      };
      if (shifts) {
        queryCourse.shifts = new ObjectId(shifts);
      }
      if (apply_majors) {
        queryCourse.apply_majors = new ObjectId(apply_majors);
      }
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchCourse.courses = { $in: getCourses.map((item) => item._id) };
      matchCountCourse._id = { $in: getCourses.map((item) => item._id) };
    }
    let matchPoor: any = {};

    let queryTimelineType = EnumConstant.TimelineType.SCHOLARSHIP;
    if (poor_id_status) {
      matchPoor.poor_id = { $exists: true };
      poor_id_status = [Number(poor_id_status)];
      if(poor_id_status == 10){
        poor_id_status = [EnumConstant.ACTIVE, EnumConstant.REJECTED, EnumConstant.REQUESTING];
      }
    }

    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let matchTypeDocument: any = {};
    if (type_scholarship_documents) {
      matchTypeDocument.type_scholarship_documents = Number(
        type_scholarship_documents
      );
    }
    let endDate = new Date(req.query.end_date);
    let minToday = new Date(new Date(req.query.end_date).setHours(0, 0, 0));
    let maxToday = new Date(new Date(req.query.end_date).setHours(23, 59, 59));
    let data = await models.school
      .aggregate([
        {
          $match: querySchool,
        },
        {
          $lookup: {
            from: "students",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$schools", "$$id"] },
                  // scholarship_status: {
                  //   $in: [EnumConstant.ACTIVE, EnumConstant.QUIT],
                  // },
                  ...matchPoor,
                  ...matchCourse,
                  ...matchTypeDocument,
                },
              },
              {
                $lookup: {
                  from: "courses",
                  let: { id: "$courses" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$id"] },
                      },
                    },
                  ],
                  as: "courses",
                },
              },
              { $unwind: { path: "$courses" } },
              {
                $lookup: {
                  from: "request_timelines",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        // status: {
                        //   $in: [
                        //     EnumConstant.ACTIVE,
                        //     EnumConstant.QUIT,
                        //     EnumConstant.RESUME_STUDY,
                        //   ],
                        // },
                        status: { $ne: EnumConstant.DELETE },
                        timeline_type: queryTimelineType,
                        createdAt: { $lte: endDate },
                      },
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1 },
                    {
                      $project: {
                        _id: {
                          $cond: {
                            if: {
                              $eq: ["$status", EnumConstant.RESUME_STUDY],
                            },
                            then: EnumConstant.ACTIVE,
                            else: "$status",
                          },
                        },
                        createdAt: 1,
                      },
                    },
                  ],
                  as: "request_timelines",
                },
              },
              { $unwind: { path: "$request_timelines" }},

              //relookup request_timelines to filter id_poor approval
              {
                $lookup: {
                  from: "request_timelines",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        status: { $ne: EnumConstant.DELETE },
                        timeline_type: EnumConstant.TimelineType.IDPOOR,
                        createdAt: { $lte: endDate },
                      },
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1 },
                    {
                      $project: {
                        _id: {
                          $cond: {
                            if: {
                              $eq: ["$status", EnumConstant.RESUME_STUDY],
                            },
                            then: EnumConstant.ACTIVE,
                            else: "$status",
                          },
                        },
                        createdAt: 1,
                        timeline_type: 1,
                        status: 1,
                      },
                    },
                  ],
                  as: "request_timelines_id_poor",
                },
              },
              { $unwind: { path: "$request_timelines_id_poor", preserveNullAndEmptyArrays: true  } },
              {
                $lookup: {
                  from: "student_internships",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        status: EnumConstant.ACTIVE,
                        start_date: { $lte: endDate },
                      },
                    },
                    { $limit: 1 },
                  ],
                  as: "student_internships",
                },
              },
              {
                $unwind: {
                  path: "$student_internships",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "student_occupations",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        status: EnumConstant.ACTIVE,
                        has_job: EnumConstant.ACTIVE,
                      },
                    },
                    { $limit: 1 },
                  ],
                  as: "student_occupations",
                },
              },
              {
                $unwind: {
                  path: "$student_occupations",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "attendance_students",
                  let: { studentId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$studentId"],
                        },
                      },
                    },
                  ],
                  as: "attendance_students",
                },
              },
              {
                $group: {
                  _id: null,
                  scholarship_approved_student: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $in: [
                                "$request_timelines._id",
                                [
                                  EnumConstant.ACTIVE,
                                  EnumConstant.QUIT,
                                  EnumConstant.RESUME_STUDY,
                                ],
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  scholarship_approved_student_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                            {
                              $in: [
                                "$request_timelines._id",
                                [
                                  EnumConstant.ACTIVE,
                                  EnumConstant.QUIT,
                                  EnumConstant.RESUME_STUDY,
                                ],
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_before_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            // { $eq: ["$scholarship_status", EnumConstant.QUIT] },
                            {
                              $gt: [
                                "$courses.course_start",
                                "$request_timelines.createdAt",
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_before_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            // { $eq: ["$scholarship_status", EnumConstant.QUIT] },
                            {
                              $gt: [
                                "$courses.course_start",
                                "$request_timelines.createdAt",
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_during_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            {
                              $ne: [
                                "$type_leavel_scholarships",
                                controllers.typeLeaveScholarship.status
                                  .NOT_ENOUGH_DOCUMENT,
                              ],
                            },
                            {
                              $lte: [
                                "$courses.course_start",
                                "$request_timelines.createdAt",
                              ],
                            },
                            {
                              $gte: [
                                "$courses.course_end",
                                "$request_timelines.createdAt",
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_during_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            {
                              $ne: [
                                "$type_leavel_scholarships",
                                controllers.typeLeaveScholarship.status
                                  .NOT_ENOUGH_DOCUMENT,
                              ],
                            },
                            {
                              $lte: [
                                "$courses.course_start",
                                "$request_timelines.createdAt",
                              ],
                            },
                            {
                              $gte: [
                                "$courses.course_end",
                                "$request_timelines.createdAt",
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_during_studying_not_enough_document: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            {
                              $eq: [
                                "$type_leavel_scholarships",
                                controllers.typeLeaveScholarship.status
                                  .NOT_ENOUGH_DOCUMENT,
                              ],
                            },
                            {
                              $lte: [
                                "$courses.course_start",
                                "$request_timelines.createdAt",
                              ],
                            },
                            {
                              $gte: [
                                "$courses.course_end",
                                "$request_timelines.createdAt",
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_during_studying_not_enough_document_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            {
                              $eq: [
                                "$type_leavel_scholarships",
                                controllers.typeLeaveScholarship.status
                                  .NOT_ENOUGH_DOCUMENT,
                              ],
                            },
                            {
                              $lt: [
                                "$courses.course_start",
                                "$request_timelines.createdAt",
                              ],
                            },
                            {
                              $gt: [
                                "$courses.course_end",
                                "$request_timelines.createdAt",
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  waiting_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            { $gt: ["$courses.course_start", maxToday] },
                            // { $gt: ["$courses.course_end", maxToday]},
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  waiting_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            { $gt: ["$courses.course_start", maxToday] },
                            // { $gt: ["$courses.course_end", maxToday]},
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_waiting_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            {
                              $gte: ["$request_timelines.createdAt", minToday],
                            },
                            {
                              $lte: ["$request_timelines.createdAt", maxToday],
                            },
                            { $gt: ["$courses.course_start", maxToday] },
                            // { $gt: ["$courses.course_end", maxToday]},
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_waiting_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            {
                              $gte: ["$request_timelines.createdAt", minToday],
                            },
                            {
                              $lte: ["$request_timelines.createdAt", maxToday],
                            },
                            { $gt: ["$courses.course_start", maxToday] },
                            // { $gt: ["$courses.course_end", maxToday]},
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            // { $eq: ["$scholarship_status", EnumConstant.ACTIVE ] },
                            { $lt: ["$courses.course_start", maxToday] },
                            { $gt: ["$courses.course_end", minToday] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            // { $eq: ["$scholarship_status", EnumConstant.ACTIVE ] },
                            { $lt: ["$courses.course_start", maxToday] },
                            { $gt: ["$courses.course_end", minToday] },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  id_poor_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            { $eq: ["$poor_status", EnumConstant.ACTIVE] },
                            { $lt: ["$courses.course_start", maxToday] },
                            { $gt: ["$courses.course_end", minToday] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $eq: [
                                        "$request_timelines_id_poor.status",
                                        EnumConstant.ACTIVE,
                                      ],
                                    },
                                    {
                                      $eq: [
                                        "$request_timelines_id_poor.timeline_type",
                                        EnumConstant.TimelineType.IDPOOR,
                                      ],
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  id_poor_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            { $eq: ["$poor_status", EnumConstant.ACTIVE] },
                            { $lt: ["$courses.course_start", maxToday] },
                            { $gt: ["$courses.course_end", minToday] },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $eq: [
                                        "$request_timelines_id_poor.status",
                                        EnumConstant.ACTIVE,
                                      ],
                                    },
                                    {
                                      $eq: [
                                        "$request_timelines_id_poor.timeline_type",
                                        EnumConstant.TimelineType.IDPOOR,
                                      ],
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  finish_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            // { $eq: ["$scholarship_status", EnumConstant.ACTIVE] },
                            { $lt: ["$courses.course_end", minToday] },
                            // {
                            //   $ne: [
                            //     "$type_leavel_scholarships",
                            //     controllers.typeLeaveScholarship.status
                            //       .LEAVE_BEFORE_EVALUATE,
                            //   ],
                            // },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  finish_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            // { $eq: ["$scholarship_status", EnumConstant.ACTIVE ] },
                            { $lt: ["$courses.course_end", minToday] },
                            // {
                            //   $ne: [
                            //     "$type_leavel_scholarships",
                            //     controllers.typeLeaveScholarship.status
                            //       .LEAVE_BEFORE_EVALUATE,
                            //   ],
                            // },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_study: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            {
                              $and: [
                                {
                                  $eq: [
                                    "$request_timelines._id",
                                    EnumConstant.ACTIVE,
                                  ],
                                },
                                { $gte: ["$courses.course_start", minToday] },
                                { $lte: ["$courses.course_start", maxToday] },
                                // { $eq: ["$scholarship_status", EnumConstant.ACTIVE] },
                              ],
                            },
                            {
                              $and: [
                                {
                                  $eq: [
                                    "$request_timelines._id",
                                    EnumConstant.ACTIVE,
                                  ],
                                },
                                // { $lte: ["$courses.course_start", maxToday]},
                                // { $gte: ["$courses.course_end", minToday] },
                                { $lt: ["$courses.course_start", maxToday] },
                                { $gt: ["$courses.course_end", minToday] },
                                // { $eq: ["$scholarship_status", EnumConstant.ACTIVE] },
                                {
                                  $gte: [
                                    "$request_timelines.createdAt",
                                    minToday,
                                  ],
                                },
                                {
                                  $lte: [
                                    "$request_timelines.createdAt",
                                    maxToday,
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_study_female: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            {
                              $and: [
                                {
                                  $eq: [
                                    "$request_timelines._id",
                                    EnumConstant.ACTIVE,
                                  ],
                                },
                                { $gt: ["$courses.course_start", minToday] },
                                { $lt: ["$courses.course_start", maxToday] },
                                // { $eq: ["$scholarship_status", EnumConstant.ACTIVE] },
                                {
                                  $eq: ["$gender", EnumConstant.Gender.FEMALE],
                                },
                              ],
                            },
                            {
                              $and: [
                                // { $lte: ["$courses.course_start", maxToday]},
                                // { $gte: ["$courses.course_end", minToday]},
                                // { $eq: ["$scholarship_status", EnumConstant.ACTIVE] },
                                { $lt: ["$courses.course_start", maxToday] },
                                { $gt: ["$courses.course_end", minToday] },
                                {
                                  $gte: [
                                    "$request_timelines.createdAt",
                                    minToday,
                                  ],
                                },
                                {
                                  $lte: [
                                    "$request_timelines.createdAt",
                                    maxToday,
                                  ],
                                },
                                {
                                  $eq: [
                                    "$request_timelines._id",
                                    EnumConstant.ACTIVE,
                                  ],
                                },
                                {
                                  $eq: ["$gender", EnumConstant.Gender.FEMALE],
                                },
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  internship: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$student_internships", false] },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  internship_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$student_internships", false] },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  employment: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$student_occupations", false] },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  employment_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$student_occupations", false] },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_internship: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$student_internships", false] },
                        {
                          $cond: [
                            {
                              $and: [
                                {
                                  $lte: [
                                    "$student_internships.createdAt",
                                    maxToday,
                                  ],
                                },
                                {
                                  $gte: [
                                    "$student_internships.createdAt",
                                    minToday,
                                  ],
                                },
                              ],
                            },
                            {
                              $cond: [
                                { $ifNull: [poor_id_status, false] },
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in:[
                                            "$request_timelines_id_poor._id",
                                            poor_id_status,
                                          ]
                                        },
                                      ],
                                    },
                                    1,
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_internship_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$student_internships", false] },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            {
                              $and: [
                                {
                                  $lte: [
                                    "$student_internships.createdAt",
                                    maxToday,
                                  ],
                                },
                                {
                                  $gte: [
                                    "$student_internships.createdAt",
                                    minToday,
                                  ],
                                },
                              ],
                            },
                            {
                              $cond: [
                                { $ifNull: [poor_id_status, false] },
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in:[
                                            "$request_timelines_id_poor._id",
                                            poor_id_status,
                                          ]
                                        },
                                      ],
                                    },
                                    1,
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_finish_studying: {
                    $sum: {
                      $cond: [
                        {
                          $eq: ["$request_timelines._id", EnumConstant.ACTIVE],
                        },
                        {
                          $cond: [
                            {
                              $and: [
                                // {
                                //   $ne: [
                                //     "$type_leavel_scholarships",
                                //     controllers.typeLeaveScholarship.status
                                //       .LEAVE_BEFORE_EVALUATE,
                                //   ],
                                // },
                                { $gte: ["$courses.course_end", minToday] },
                                { $lte: ["$courses.course_end", maxToday] },
                              ],
                            },
                            {
                              $cond: [
                                { $ifNull: [poor_id_status, false] },
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in:[
                                            "$request_timelines_id_poor._id",
                                            poor_id_status,
                                          ]
                                        },
                                      ],
                                    },
                                    1,
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_finish_studying_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.ACTIVE,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            {
                              $and: [
                                // {
                                //   $ne: [
                                //     "$type_leavel_scholarships",
                                //     controllers.typeLeaveScholarship.status
                                //       .LEAVE_BEFORE_EVALUATE,
                                //   ],
                                // },
                                { $gte: ["$courses.course_end", minToday] },
                                { $lte: ["$courses.course_end", maxToday] },
                              ],
                            },
                            {
                              $cond: [
                                { $ifNull: [poor_id_status, false] },
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in:[
                                            "$request_timelines_id_poor._id",
                                            poor_id_status,
                                          ]
                                        },
                                      ],
                                    },
                                    1,
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_employment: {
                    $sum: {
                      $cond: [
                        { $ifNull: ["$student_occupations", false] },
                        {
                          $cond: [
                            {
                              $and: [
                                { $gte: ["$courses.course_end", minToday] },
                              ],
                            },
                            {
                              $cond: [
                                { $ifNull: [poor_id_status, false] },
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in:[
                                            "$request_timelines_id_poor._id",
                                            poor_id_status,
                                          ]
                                        },
                                      ],
                                    },
                                    1,
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  new_employment_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$student_occupations", false] },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            {
                              $and: [
                                { $gte: ["$courses.course_end", minToday] },
                              ],
                            },
                            {
                              $cond: [
                                { $ifNull: [poor_id_status, false] },
                                {
                                  $cond: [
                                    {
                                      $and: [
                                        {
                                          $in:[
                                            "$request_timelines_id_poor._id",
                                            poor_id_status,
                                          ]
                                        },
                                      ],
                                    },
                                    1,
                                    0,
                                  ],
                                },
                                1,
                              ],
                            },
                            0,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  student_apply: {
                    $sum: 1,
                  },
                  student_female_apply: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  quit_before_evaluate: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            {
                              $lt: [
                                "$courses.course_end",
                                "$request_timelines.createdAt",
                              ],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  quit_before_evaluate_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.QUIT,
                              ],
                            },
                            {
                              $lt: [
                                "$courses.course_end",
                                "$request_timelines.createdAt",
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  doing_internship: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$student_internships", false] },
                            {
                              $gte: ["$student_internships.end_date", maxToday],
                            },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  doing_internship_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ifNull: ["$student_internships", false] },
                            {
                              $gte: ["$student_internships.end_date", minToday],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        {
                          $cond: [
                            { $ifNull: [poor_id_status, false] },
                            {
                              $cond: [
                                {
                                  $and: [
                                    {
                                      $in:[
                                        "$request_timelines_id_poor._id",
                                        poor_id_status,
                                      ]
                                    },
                                  ],
                                },
                                1,
                                0,
                              ],
                            },
                            1,
                          ],
                        },
                        0,
                      ],
                    },
                  },
                  waiting_approval: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.REQUESTING,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  waiting_approval_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.REQUESTING,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  reject_during_waiting_approval: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.REJECTED,
                              ],
                            },
                          ],
                        },
                        1,
                        0,
                      ]
                    }
                  },
                  reject_during_waiting_approval_female: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            {
                              $eq: [
                                "$request_timelines._id",
                                EnumConstant.REJECTED,
                              ],
                            },
                            { $eq: ["$gender", EnumConstant.Gender.FEMALE] },
                          ],
                        },
                        1,
                        0,
                      ]
                    },
                  },
                },
              },
              {
                $project: { _id: 0 },
              },
            ],
            as: "student_data",
          },
        },
        { $unwind: { path: "$student_data" } }, //preserveNullAndEmptyArrays: true
        {
          $replaceRoot: {
            newRoot: {
              $mergeObjects: [
                {
                  _id: "$_id",
                  name: "$name",
                  name_en: "$name_en",
                  address: "$address",
                  profile_image: "$profile_image",
                  code: "$code",
                  id_code: "$id_code",
                },
                "$student_data",
              ],
            },
          },
        },
        {
          $addFields: {
            scholarship_approved_student: {
              $cond: [
                { $ifNull: ["$scholarship_approved_student", false] },
                "$scholarship_approved_student",
                0,
              ],
            },
            scholarship_approved_student_female: {
              $cond: [
                { $ifNull: ["$scholarship_approved_student_female", false] },
                "$scholarship_approved_student_female",
                0,
              ],
            },
            quit_before_studying: {
              $cond: [
                { $ifNull: ["$quit_before_studying", false] },
                "$quit_before_studying",
                0,
              ],
            },
            quit_before_studying_female: {
              $cond: [
                { $ifNull: ["$quit_before_studying_female", false] },
                "$quit_before_studying_female",
                0,
              ],
            },
            quit_during_studying: {
              $cond: [
                { $ifNull: ["$quit_during_studying", false] },
                "$quit_during_studying",
                0,
              ],
            },
            quit_during_studying_female: {
              $cond: [
                { $ifNull: ["$quit_during_studying_female", false] },
                "$quit_during_studying_female",
                0,
              ],
            },
            waiting_studying: {
              $cond: [
                { $ifNull: ["$waiting_studying", false] },
                "$waiting_studying",
                0,
              ],
            },
            waiting_studying_female: {
              $cond: [
                { $ifNull: ["$waiting_studying_female", false] },
                "$waiting_studying_female",
                0,
              ],
            },
            new_waiting_studying: {
              $cond: [
                { $ifNull: ["$new_waiting_studying", false] },
                "$new_waiting_studying",
                0,
              ],
            },
            new_waiting_studying_female: {
              $cond: [
                { $ifNull: ["$new_waiting_studying_female", false] },
                "$new_waiting_studying_female",
                0,
              ],
            },
            studying: {
              $cond: [{ $ifNull: ["$studying", false] }, "$studying", 0],
            },
            studying_female: {
              $cond: [
                { $ifNull: ["$studying_female", false] },
                "$studying_female",
                0,
              ],
            },
            id_poor_studying: {
              $cond: [
                { $ifNull: ["$id_poor_studying", false] },
                "$id_poor_studying",
                0,
              ],
            },
            id_poor_studying_female: {
              $cond: [
                { $ifNull: ["$id_poor_studying_female", false] },
                "$id_poor_studying_female",
                0,
              ],
            },
            finish_studying: {
              $cond: [
                { $ifNull: ["$finish_studying", false] },
                "$finish_studying",
                0,
              ],
            },
            finish_studying_female: {
              $cond: [
                { $ifNull: ["$finish_studying_female", false] },
                "$finish_studying_female",
                0,
              ],
            },
            internship: {
              $cond: [{ $ifNull: ["$internship", false] }, "$internship", 0],
            },
            internship_female: {
              $cond: [
                { $ifNull: ["$internship_female", false] },
                "$internship_female",
                0,
              ],
            },
            employment: {
              $cond: [{ $ifNull: ["$employment", false] }, "$employment", 0],
            },
            employment_female: {
              $cond: [
                { $ifNull: ["$employment_female", false] },
                "$employment_female",
                0,
              ],
            },
            new_study: {
              $cond: [{ $ifNull: ["$new_study", false] }, "$new_study", 0],
            },
            new_study_female: {
              $cond: [
                { $ifNull: ["$new_study_female", false] },
                "$new_study_female",
                0,
              ],
            },
            quit_during_studying_not_enough_document: {
              $cond: [
                {
                  $ifNull: ["$quit_during_studying_not_enough_document", false],
                },
                "$quit_during_studying_not_enough_document",
                0,
              ],
            },
            quit_during_studying_not_enough_document_female: {
              $cond: [
                {
                  $ifNull: [
                    "$quit_during_studying_not_enough_document_female",
                    false,
                  ],
                },
                "$quit_during_studying_not_enough_document_female",
                0,
              ],
            },
            new_internship: {
              $cond: [
                {
                  $ifNull: ["$new_internship", false],
                },
                "$new_internship",
                0,
              ],
            },
            new_internship_female: {
              $cond: [
                {
                  $ifNull: ["$new_internship_female", false],
                },
                "$new_internship_female",
                0,
              ],
            },
            new_finish_studying: {
              $cond: [
                {
                  $ifNull: ["$new_finish_studying", false],
                },
                "$new_finish_studying",
                0,
              ],
            },
            new_finish_studying_female: {
              $cond: [
                {
                  $ifNull: ["$new_finish_studying_female", false],
                },
                "$new_finish_studying_female",
                0,
              ],
            },
            new_employment: {
              $cond: [
                {
                  $ifNull: ["$new_employment", false],
                },
                "$new_employment",
                0,
              ],
            },
            new_employment_female: {
              $cond: [
                {
                  $ifNull: ["$new_employment_female", false],
                },
                "$new_employment_female",
                0,
              ],
            },
            student_apply: {
              $cond: [
                {
                  $ifNull: ["$student_apply", false],
                },
                "$student_apply",
                0,
              ],
            },
            student_female_apply: {
              $cond: [
                {
                  $ifNull: ["$student_female_apply", false],
                },
                "$student_female_apply",
                0,
              ],
            },
            quit_before_evaluate: {
              $cond: [
                {
                  $ifNull: ["$quit_before_evaluate", false],
                },
                "$quit_before_evaluate",
                0,
              ],
            },
            quit_before_evaluate_female: {
              $cond: [
                {
                  $ifNull: ["$quit_before_evaluate_female", false],
                },
                "$quit_before_evaluate_female",
                0,
              ],
            },
            doing_internship: {
              $cond: [
                { $ifNull: ["$doing_internship", false] },
                "$doing_internship",
                0,
              ],
            },
            doing_internship_female: {
              $cond: [
                { $ifNull: ["$doing_internship_female", false] },
                "$doing_internship_female",
                0,
              ],
            },
            waiting_approval: {
              $cond: [
                { $ifNull: ["$waiting_approval", false] },
                "$waiting_approval",
                0,
              ],
            },
            waiting_approval_female: {
              $cond: [
                { $ifNull: ["$waiting_approval_female", false] },
                "$waiting_approval_female",
                0,
              ],
            },
            reject_during_waiting_approval: {
              $cond: [
                { $ifNull: ["$reject_during_waiting_approval", false] },
                "$reject_during_waiting_approval",
                0,
              ],
            },
            reject_during_waiting_approval_female: {
              $cond: [
                { $ifNull: ["$reject_during_waiting_approval_female", false] },
                "$reject_during_waiting_approval_female",
                0,
              ],
            },
          },
        },
        {
          $sort: {
            id_code: 1,
          },
        },
        {
          $lookup: {
            from: "courses",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$schools", "$$id"] },
                  status: { $ne: EnumConstant.DELETE },
                  ...matchCountCourse,
                },
              },
              {
                $group: {
                  _id: null,
                  course_new: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$course_start", minToday] },
                            { $lte: ["$course_start", maxToday] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  course_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $lt: ["$course_start", maxToday] },
                            { $gt: ["$course_end", minToday] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  course_finish: {
                    $sum: {
                      $cond: [
                        {
                          $and: [{ $lt: ["$course_end", minToday] }],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  new_course_finish: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$course_end", minToday] },
                            { $lte: ["$course_end", maxToday] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            as: "courses",
          },
        },
        {
          $unwind: { path: "$courses", preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            course_new: {
              $cond: [
                { $ifNull: ["$courses.course_new", false] },
                "$courses.course_new",
                0,
              ],
            },
            course_studying: {
              $cond: [
                { $ifNull: ["$courses.course_studying", false] },
                "$courses.course_studying",
                0,
              ],
            },
            course_finish: {
              $cond: [
                { $ifNull: ["$courses.course_finish", false] },
                "$courses.course_finish",
                0,
              ],
            },
            new_course_finish: {
              $cond: [
                { $ifNull: ["$courses.new_course_finish", false] },
                "$courses.new_course_finish",
                0,
              ],
            },
          },
        },
        {
          $project: {
            courses: 0,
          },
        },
        {
          $group: {
            _id: "$address.city_provinces",
            schools: { $push: "$$ROOT" },
            scholarship_approved_student: {
              $sum: "$scholarship_approved_student",
            },
            scholarship_approved_student_female: {
              $sum: "$scholarship_approved_student_female",
            },
            quit_before_studying: { $sum: "$quit_before_studying" },
            quit_before_studying_female: {
              $sum: "$quit_before_studying_female",
            },
            quit_during_studying: { $sum: "$quit_during_studying" },
            quit_during_studying_female: {
              $sum: "$quit_during_studying_female",
            },
            waiting_studying: { $sum: "$waiting_studying" },
            waiting_studying_female: { $sum: "$waiting_studying_female" },
            new_waiting_studying: { $sum: "$new_waiting_studying" },
            new_waiting_studying_female: {
              $sum: "$new_waiting_studying_female",
            },
            studying: { $sum: "$studying" },
            studying_female: { $sum: "$studying_female" },
            id_poor_studying: { $sum: "$id_poor_studying" },
            id_poor_studying_female: { $sum: "$id_poor_studying_female" },
            finish_studying: { $sum: "$finish_studying" },
            finish_studying_female: { $sum: "$finish_studying_female" },
            internship: { $sum: "$internship" },
            internship_female: { $sum: "$internship_female" },
            employment: { $sum: "$employment" },
            employment_female: { $sum: "$employment_female" },
            new_study: { $sum: "$new_study" },
            new_study_female: { $sum: "$new_study_female" },
            course_new: { $sum: "$course_new" },
            course_studying: { $sum: "$course_studying" },
            quit_during_studying_not_enough_document: {
              $sum: "$quit_during_studying_not_enough_document",
            },
            quit_during_studying_not_enough_document_female: {
              $sum: "$quit_during_studying_not_enough_document_female",
            },
            new_internship: {
              $sum: "$new_internship",
            },
            new_internship_female: {
              $sum: "$new_internship_female",
            },
            new_finish_studying: {
              $sum: "$new_finish_studying",
            },
            new_finish_studying_female: {
              $sum: "$new_finish_studying_female",
            },
            new_course_finish: {
              $sum: "$new_course_finish",
            },
            course_finish: {
              $sum: "$course_finish",
            },
            new_employment: {
              $sum: "$new_employment",
            },
            new_employment_female: {
              $sum: "$new_employment_female",
            },
            student_apply: {
              $sum: "$student_apply",
            },
            student_female_apply: {
              $sum: "$student_female_apply",
            },
            quit_before_evaluate: {
              $sum: "$quit_before_evaluate",
            },
            quit_before_evaluate_female: {
              $sum: "$quit_before_evaluate_female",
            },
            doing_internship: {
              $sum: "$doing_internship",
            },
            doing_internship_female: {
              $sum: "$doing_internship_female",
            },
            waiting_approval: {
              $sum: "$waiting_approval",
            },
            waiting_approval_female: {
              $sum: "$waiting_approval_female",
            },
            reject_during_waiting_approval: {
              $sum: "$reject_during_waiting_approval",
            },
            reject_during_waiting_approval_female: {
              $sum: "$reject_during_waiting_approval_female",
            },
          },
        },
        {
          $lookup: {
            from: "city_provinces",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "city_provinces",
          },
        },
        {
          $unwind: {
            path: "$city_provinces",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            name: "$city_provinces.name",
            name_en: "$city_provinces.name_en",
          },
        },
        {
          $sort: {
            "city_provinces.order": 1,
          },
        },
        {
          $project: {
            city_provinces: 0,
            "schools.address": 0,
          },
        },
      ])
      .allowDiskUse(true);
    // return data;
    let jsonData = CommonUtil.JSONParse(data);
    let keyToRemove = [
      "scholarship_approved_student",
      "scholarship_approved_student_female",
      "waiting_studying",
      "waiting_studying_female",
      "quit_before_studying",
      "quit_before_studying_female",
      "studying",
      "studying_female",
      "quit_during_studying",
      "quit_during_studying_female",
      "internship",
      "internship_female",
      "finish_studying",
      "finish_studying_female",
      "employment",
      "employment_female",
      "new_study",
      "new_study_female",
      "course_new",
      "course_studying",
      "new_waiting_studying",
      "new_waiting_studying_female",
      "waiting_studying_female",
      "id_poor_studying",
      "id_poor_studying_female",
      "quit_during_studying_not_enough_document_female",
      "quit_during_studying_not_enough_document",
      "new_internship",
      "new_internship_female",
      "new_finish_studying",
      "new_finish_studying_female",
      "new_employment",
      "new_employment_female",
      "new_course_finish",
      "course_finish",
      "student_apply",
      "student_female_apply",
      "quit_before_evaluate",
      "quit_before_evaluate_female",
      "doing_internship",
      "doing_internship_female",
      "waiting_approval",
      "waiting_approval_female",
      "reject_during_waiting_approval",
      "reject_during_waiting_approval_female",
    ];
    let headerColumns: any[] = [];
    let headerTitle: any = [
      "សិស្សដែលបានចុះឈ្មោះចូលរៀន",
      "រង់ចាំអនុម័ត",
      "ចំនួនសិស្សបដិសេធ",
      "ចំនួនសិស្សអនុម័ត",
      "រងចាំចូលរៀនថ្មីថ្ងៃនេះ",
      "រង់ចាំចូលរៀន",
      "បោះបង់មុនចូលរៀន",
      "បោះបង់មុនពេលធ្វើតេស្តវាយតម្លៃ",
      "ចូលរៀនថ្មីថ្ងៃនេះ",
      "កំពុងរៀន",
      "បោះបង់ពេលរៀន",
      "បោះបង់ពេលរៀនខ្វះឯកសារ",
      "កម្មសិក្សាថ្មីថ្ងៃនេះ",
      "បានចុះកម្មសិក្សា",
      "កំពុងចុះកម្មសិក្សា",
      "បានបញ្ចប់ការសិក្សា",
      "ទទួលបានការងារ",
      "បានបញ្ចប់ការសិក្សាថ្មីថ្ងៃនេះ",
      "ទទួលបានការងារថ្មីថ្ងៃនេះ",
      "វគ្គសិក្សា",
    ];
    for (var i = 0; i < headerTitle.length; i++) {
      headerColumns.push({ _id: i + 1, name: headerTitle[i] });
    }
    for (var i = 0; i < jsonData.length; i++) {
      for (var school = 0; school < jsonData[i].schools.length; school++) {
        let studentData: any[] = [];
        let sch = jsonData[i].schools[school];
        studentData.push({
          _id: 1,
          total_student: sch.student_apply,
          total_female: sch.student_female_apply,
        });
        studentData.push({
          _id: 2,
          total_student: sch.waiting_approval,
          total_female: sch.waiting_approval_female,
        });
        studentData.push({
          _id: 3,
          total_student: sch.reject_during_waiting_approval,
          total_female: sch.reject_during_waiting_approval_female,
        });
        studentData.push({
          _id: 4,
          total_student: sch.scholarship_approved_student,
          total_female: sch.scholarship_approved_student_female,
        });
        studentData.push({
          _id: 5,
          total_student: sch.new_waiting_studying,
          total_female: sch.new_waiting_studying_female,
        });
        studentData.push({
          _id: 6,
          total_student: sch.waiting_studying,
          total_female: sch.waiting_studying_female,
        });
        studentData.push({
          _id: 7,
          total_student: sch.quit_before_studying,
          total_female: sch.quit_before_studying_female,
        });
        studentData.push({
          _id: 8,
          total_student: sch.quit_before_evaluate,
          total_female: sch.quit_before_evaluate_female,
        });
        studentData.push({
          _id: 9,
          total_student: sch.new_study,
          total_female: sch.new_study_female,
        });
        studentData.push({
          _id: 10,
          total_student: sch.studying,
          total_female: sch.studying_female,
        });
        // studentData.push({ _id: 7, total_student: sch.id_poor_studying, total_female: sch.id_poor_studying_female });
        studentData.push({
          _id: 11,
          total_student: sch.quit_during_studying,
          total_female: sch.quit_during_studying_female,
        });
        studentData.push({
          _id: 12,
          total_student: sch.quit_during_studying_not_enough_document,
          total_female: sch.quit_during_studying_not_enough_document_female,
        });
        studentData.push({
          _id: 13,
          total_student: sch.new_internship,
          total_female: sch.new_internship_female,
        });
        studentData.push({
          _id: 14,
          total_student: sch.internship,
          total_female: sch.internship_female,
        });
        studentData.push({
          _id: 15,
          total_student: sch.doing_internship,
          total_female: sch.doing_internship_female,
        });
        studentData.push({
          _id: 16,
          total_student: sch.finish_studying,
          total_female: sch.finish_studying_female,
          total_course_finish: sch.course_finish,
        });
        studentData.push({
          _id: 17,
          total_student: sch.employment,
          total_female: sch.employment_female,
        });
        studentData.push({
          _id: 18,
          total_student: sch.new_finish_studying,
          total_female: sch.new_finish_studying_female,
          total_new_course_finish: sch.new_course_finish,
        });
        studentData.push({
          _id: 19,
          total_student: sch.new_employment,
          total_female: sch.new_employment_female,
        });
        studentData.push({
          _id: 20,
          total_student: sch.course_studying,
          total_female: sch.course_new,
        });

        jsonData[i].schools[school].student_data = studentData;
        jsonData[i].schools[school] = CommonUtil.removeKeys(
          jsonData[i].schools[school],
          keyToRemove
        );
      }
      let studentData: any[] = [];
      let city = jsonData[i];
      studentData.push({
        _id: 1,
        total_student: city.student_apply,
        total_female: city.student_female_apply,
      });
      studentData.push({
        _id: 2,
        total_student: city.waiting_approval,
        total_female: city.waiting_approval_female,
      });
      studentData.push({
        _id: 3,
        total_student: city.reject_during_waiting_approval,
        total_female: city.reject_during_waiting_approval_female,
      });
      studentData.push({
        _id: 4,
        total_student: city.scholarship_approved_student,
        total_female: city.scholarship_approved_student_female,
      });
      studentData.push({
        _id: 5,
        total_student: city.new_waiting_studying,
        total_female: city.new_waiting_studying_female,
      });
      studentData.push({
        _id: 6,
        total_student: city.waiting_studying,
        total_female: city.waiting_studying_female,
      });
      studentData.push({
        _id: 7,
        total_student: city.quit_before_studying,
        total_female: city.quit_before_studying_female,
      });
      studentData.push({
        _id: 8,
        total_student: city.quit_before_evaluate,
        total_female: city.quit_before_evaluate_female,
      });
      studentData.push({
        _id: 9,
        total_student: city.new_study,
        total_female: city.new_study_female,
      });
      studentData.push({
        _id: 10,
        total_student: city.studying,
        total_female: city.studying_female,
      });
      // studentData.push({ _id: 7, total_student: city.id_poor_studying, total_female: city.id_poor_studying_female });
      studentData.push({
        _id: 11,
        total_student: city.quit_during_studying,
        total_female: city.quit_during_studying_female,
      });
      studentData.push({
        _id: 12,
        total_student: city.quit_during_studying_not_enough_document,
        total_female: city.quit_during_studying_not_enough_document_female,
      });
      studentData.push({
        _id: 13,
        total_student: city.new_internship,
        total_female: city.new_internship_female,
      });
      studentData.push({
        _id: 14,
        total_student: city.internship,
        total_female: city.internship_female,
      });
      studentData.push({
        _id: 15,
        total_student: city.doing_internship,
        total_female: city.doing_internship_female,
      });
      studentData.push({
        _id: 16,
        total_student: city.finish_studying,
        total_female: city.finish_studying_female,
        total_course_finish: city.course_finish,
      });
      studentData.push({
        _id: 17,
        total_student: city.employment,
        total_female: city.employment_female,
      });
      studentData.push({
        _id: 18,
        total_student: city.new_finish_studying,
        total_female: city.new_finish_studying_female,
        total_new_course_finish: city.new_course_finish,
      });
      studentData.push({
        _id: 19,
        total_student: city.new_employment,
        total_female: city.new_employment_female,
      });
      studentData.push({
        _id: 20,
        total_student: city.course_studying,
        total_female: city.course_new,
      });
      jsonData[i].student_data = studentData;
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
    }
    return {
      // start_date: startDate,
      // start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async studentStudyStatusByMajor(req: any) {
    let { apply_majors, shifts, schools, poor_id_status, type_poverty_status } =
      req.query;
    if (req.body._user.schools) {
      schools = req.body._user.schools;
    }
    let queryMajor: any = {
      status: EnumConstant.ACTIVE,
      type_projects: EnumConstant.TypeProject.scholarship,
    };
    if (apply_majors) {
      queryMajor._id = new ObjectId(apply_majors);
    }
    let queryTimelineType = EnumConstant.TimelineType.SCHOLARSHIP;

    let matchPoor: any = {};
    if (poor_id_status) {
      matchPoor.poor_id = { $exists: true };
      // queryTimelineType = EnumConstant.TimelineType.IDPOOR
      poor_id_status = [Number(poor_id_status)];
      if(poor_id_status == 10){
        poor_id_status = [EnumConstant.ACTIVE, EnumConstant.REJECTED, EnumConstant.REQUESTING];
      }
    }
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let matchCourse: any = {};
    if (shifts || schools) {
      let queryCourse: any = {
        status: { $ne: EnumConstant.DELETE },
      };
      if (shifts) {
        queryCourse.shifts = shifts;
      }
      if (schools) {
        queryCourse.schools = new ObjectId(schools);
      }
      let getCourses = await controllers.course.getManyNoCount({
        query: queryCourse,
        select: "_id",
      });
      matchCourse._id = { $in: getCourses.map((item) => item._id) };
    }
    let minToday = new Date(new Date(req.query.end_date).setHours(0, 0, 0));
    let maxToday = new Date(new Date(req.query.end_date).setHours(23, 59, 59));
    let endDate = new Date(req.query.end_date);
    // let [startDate, endDate] = CommonUtil.parseStartDateEndDate(req.query.start_date, req.query.end_date);
    let data = await models.applyMajor
      .aggregate([
        {
          $match: queryMajor,
        },
        {
          $lookup: {
            from: "courses",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$apply_majors", "$$id"] },
                  status: { $ne: EnumConstant.DELETE },
                  ...matchCourse,
                },
              },
              {
                $lookup: {
                  from: "students",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$courses", "$$id"] },
                        // scholarship_status: {
                        //   $in: [EnumConstant.ACTIVE, EnumConstant.QUIT],
                        // },

                        ...matchPoor,
                      },
                    },
                    {
                      $lookup: {
                        from: "request_timelines",
                        let: {
                          id: "$_id",
                          scholarshipStatus: "$scholarship_status",
                        },
                        pipeline: [
                          {
                            $match: {
                              $expr: {
                                $eq: ["$students", "$$id"],
                              },
                              // status: {
                              //   $in: [
                              //     EnumConstant.ACTIVE,
                              //     EnumConstant.QUIT,
                              //     EnumConstant.RESUME_STUDY,
                              //   ],
                              // },
                              status: { $ne: EnumConstant.DELETE },
                              timeline_type: queryTimelineType,
                              createdAt: { $lte: endDate },
                            },
                          },
                          { $sort: { createdAt: -1 } },
                          { $limit: 1 },
                          {
                            $project: {
                              _id: {
                                $cond: {
                                  if: {
                                    $eq: ["$status", EnumConstant.RESUME_STUDY],
                                  },
                                  then: EnumConstant.ACTIVE,
                                  else: "$status",
                                },
                              },
                              createdAt: 1,
                            },
                          },
                        ],
                        as: "request_timelines",
                      },
                    },
                    { $unwind: { path: "$request_timelines" } },
                    //relookup request_timelines to filter id_poor approval
                    {
                      $lookup: {
                        from: "request_timelines",
                        let: {
                          id: "$_id",
                          //scholarshipStatus: "$scholarship_status",
                        },
                        pipeline: [
                          {
                            $match: {
                              $expr: {
                                $eq: ["$students", "$$id"],
                              },
                              status: { $ne: EnumConstant.DELETE },
                              timeline_type: EnumConstant.TimelineType.IDPOOR,
                              createdAt: { $lte: endDate },
                            },
                          },
                          { $sort: { createdAt: -1 } },
                          { $limit: 1 },
                          {
                            $project: {
                              _id: {
                                $cond: {
                                  if: {
                                    $eq: ["$status", EnumConstant.RESUME_STUDY],
                                  },
                                  then: EnumConstant.ACTIVE,
                                  else: "$status",
                                },
                              },
                              createdAt: 1,
                              timeline_type: 1,
                              status: 1,
                            },
                          },
                        ],
                        as: "request_timelines_id_poor",
                      },
                    },
                    { $unwind: { path: "$request_timelines_id_poor", preserveNullAndEmptyArrays: true } },
                    {
                      $lookup: {
                        from: "student_internships",
                        let: { id: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: {
                                $eq: ["$students", "$$id"],
                              },
                              status: EnumConstant.ACTIVE,
                              start_date: { $lte: endDate },
                            },
                          },
                          { $limit: 1 },
                        ],
                        as: "student_internships",
                      },
                    },
                    {
                      $unwind: {
                        path: "$student_internships",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $lookup: {
                        from: "student_occupations",
                        let: { id: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: {
                                $eq: ["$students", "$$id"],
                              },
                              status: EnumConstant.ACTIVE,
                              has_job: EnumConstant.ACTIVE,
                            },
                          },
                          { $limit: 1 },
                        ],
                        as: "student_occupations",
                      },
                    },
                    {
                      $unwind: {
                        path: "$student_occupations",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $lookup: {
                        from: "attendance_students",
                        let: { studentId: "$_id" },
                        pipeline: [
                          {
                            $match: {
                              $expr: {
                                $eq: ["$students", "$$studentId"],
                              },
                            },
                          },
                        ],
                        as: "attendance_students",
                      },
                    },
                  ],
                  as: "students",
                },
              },
              { $unwind: { path: "$students" } },
            ],
            as: "courses",
          },
        },
        { $unwind: { path: "$courses", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$_id",
            name: { $first: "$name" },
            name_en: { $first: "$name_en" },
            sectors: { $first: "$sectors" },
            code: { $first: "$code" },
            student_apply: {
              $sum: {
                $cond: [{ $ifNull: ["$courses.students", false] }, 1, 0],
              },
            },
            student_female_apply: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            scholarship_approved_student: {
              $sum: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        {
                          $in: [
                            "$courses.students.request_timelines._id",
                            [
                              EnumConstant.ACTIVE,
                              EnumConstant.QUIT,
                              EnumConstant.RESUME_STUDY,
                            ],
                          ],
                        },
                      ],
                    },
                    {
                      $cond: [
                        { $ifNull: [poor_id_status, false] },
                        {
                          $cond: [
                            {
                              $and: [
                                {
                                  $in:[
                                    "$courses.students.poor_status",
                                    poor_id_status,
                                  ]
                                },
                              ],
                            },
                            1,
                            0,
                          ],
                        },
                        1,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
            scholarship_approved_student_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                      {
                        $in: [
                          "$courses.students.request_timelines._id",
                          [
                            EnumConstant.ACTIVE,
                            EnumConstant.QUIT,
                            EnumConstant.RESUME_STUDY,
                          ],
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in:[
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ]
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_before_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $gt: [
                          "$courses.course_start",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_before_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $gt: [
                          "$courses.course_start",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_during_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $ne: [
                          "$courses.students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $lte: [
                          "$courses.course_start",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$courses.course_end",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_during_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $ne: [
                          "$courses.students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $lt: [
                          "$courses.course_start",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gt: [
                          "$courses.course_end",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_during_studying_not_enough_document: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $lte: [
                          "$courses.course_start",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$courses.course_end",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_during_studying_not_enough_document_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $lt: [
                          "$courses.course_start",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gt: [
                          "$courses.course_end",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            waiting_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $gt: ["$courses.course_start", maxToday] },
                      // { $gt: ["$courses.course_end", maxToday]},
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            waiting_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $gt: ["$courses.course_start", maxToday] },
                      // { $gt: ["$courses.course_end", maxToday]},
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            new_waiting_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $gt: ["$courses.course_start", maxToday] },
                      // { $gt: ["$courses.course_end", maxToday] },
                      {
                        $gte: [
                          "$courses.students.request_timelines.createdAt",
                          minToday,
                        ],
                      },
                      {
                        $lte: [
                          "$courses.students.request_timelines.createdAt",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            new_waiting_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $gt: ["$courses.course_start", maxToday] },
                      // { $gt: ["$courses.course_end", maxToday]},
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                      {
                        $gte: [
                          "$courses.students.request_timelines.createdAt",
                          minToday,
                        ],
                      },
                      {
                        $lte: [
                          "$courses.students.request_timelines.createdAt",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$courses.course_start", maxToday] },
                      { $gt: ["$courses.course_end", minToday] },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$courses.course_start", maxToday] },
                      { $gt: ["$courses.course_end", minToday] },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            id_poor_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.poor_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$courses.course_start", maxToday] },
                      { $gt: ["$courses.course_end", minToday] },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $eq: [
                                  "$courses.students.poor_status",
                                  EnumConstant.ACTIVE,
                                ],
                              },
                              {
                                $eq: [
                                  "$courses.students.request_timelines_id_poor.timeline_type",
                                  EnumConstant.TimelineType.IDPOOR,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            id_poor_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.poor_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$courses.course_start", maxToday] },
                      { $gt: ["$courses.course_end", minToday] },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $eq: [
                                  "$courses.students.poor_status",
                                  EnumConstant.ACTIVE,
                                ],
                              },
                              {
                                $eq: [
                                  "$courses.students.request_timelines_id_poor.timeline_type",
                                  EnumConstant.TimelineType.IDPOOR,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            finish_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$courses.course_end", minToday] },
                      // {
                      //   $ne: [
                      //     "$courses.students.type_leavel_scholarships",
                      //     controllers.typeLeaveScholarship.status
                      //       .LEAVE_BEFORE_EVALUATE,
                      //   ],
                      // },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            finish_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$courses.course_end", minToday] },
                      // {
                      //   $ne: [
                      //     "$courses.students.type_leavel_scholarships",
                      //     controllers.typeLeaveScholarship.status
                      //       .LEAVE_BEFORE_EVALUATE,
                      //   ],
                      // },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            new_study: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $and: [
                          { $gt: ["$courses.course_start", minToday] },
                          { $lt: ["$courses.course_start", maxToday] },
                          {
                            $eq: [
                              "$courses.students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                        ],
                      },
                      {
                        $and: [
                          { $lt: ["$courses.course_start", maxToday] },
                          { $gt: ["$courses.course_end", minToday] },
                          {
                            $eq: [
                              "$courses.students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          {
                            $gte: [
                              "$courses.students.request_timelines.createdAt",
                              minToday,
                            ],
                          },
                          {
                            $lte: [
                              "$courses.students.request_timelines.createdAt",
                              maxToday,
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            new_study_female: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      {
                        $and: [
                          { $gt: ["$courses.course_start", minToday] },
                          { $lt: ["$courses.course_start", maxToday] },
                          {
                            $eq: [
                              "$courses.students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          {
                            $eq: [
                              "$courses.students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                        ],
                      },
                      {
                        $and: [
                          { $lt: ["$courses.course_start", maxToday] },
                          { $gt: ["$courses.course_end", minToday] },
                          {
                            $eq: [
                              "$courses.students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          {
                            $gte: [
                              "$courses.students.request_timelines.createdAt",
                              minToday,
                            ],
                          },
                          {
                            $lte: [
                              "$courses.students.request_timelines.createdAt",
                              maxToday,
                            ],
                          },
                          {
                            $eq: [
                              "$courses.students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            internship: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students.student_internships", false] },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            internship_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ifNull: [
                          "$courses.students.student_internships",
                          false,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            employment: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students.student_occupations", false] },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            employment_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ifNull: [
                          "$courses.students.student_occupations",
                          false,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            new_internship: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students.student_internships", false] },
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $lte: [
                              "$courses.students.student_internships.createdAt",
                              maxToday,
                            ],
                          },
                          {
                            $gte: [
                              "$courses.students.student_internships.createdAt",
                              minToday,
                            ],
                          },
                        ],
                      },
                      {
                        $cond: [
                          { $ifNull: [poor_id_status, false] },
                          {
                            $cond: [
                              {
                                $and: [
                                  {
                                    $in: [
                                      "$courses.students.poor_status",
                                      poor_id_status,
                                    ],
                                  },
                                ],
                              },
                              1,
                              0,
                            ],
                          },
                          1,
                        ],
                      },
                      0,
                    ],
                  },
                  0,
                ],
              },
            },
            new_internship_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ifNull: [
                          "$courses.students.student_internships",
                          false,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $lte: [
                              "$courses.students.student_internships.createdAt",
                              maxToday,
                            ],
                          },
                          {
                            $gte: [
                              "$courses.students.student_internships.createdAt",
                              minToday,
                            ],
                          },
                        ],
                      },
                      {
                        $cond: [
                          { $ifNull: [poor_id_status, false] },
                          {
                            $cond: [
                              {
                                $and: [
                                  {
                                    $in: [
                                      "$courses.students.poor_status",
                                      poor_id_status,
                                    ],
                                  },
                                ],
                              },
                              1,
                              0,
                            ],
                          },
                          1,
                        ],
                      },
                      0,
                    ],
                  },
                  0,
                ],
              },
            },
            new_finish_studying: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$courses.students.request_timelines._id",
                      EnumConstant.ACTIVE,
                    ],
                  },
                  {
                    $cond: [
                      {
                        $and: [
                          // {
                          //   $ne: [
                          //     "$courses.students.type_leavel_scholarships",
                          //     controllers.typeLeaveScholarship.status
                          //       .LEAVE_BEFORE_EVALUATE,
                          //   ],
                          // },
                          { $gte: ["$courses.course_end", minToday] },
                          { $lte: ["$courses.course_end", maxToday] },
                        ],
                      },
                      {
                        $cond: [
                          { $ifNull: [poor_id_status, false] },
                          {
                            $cond: [
                              {
                                $and: [
                                  {
                                    $in: [
                                      "$courses.students.poor_status",
                                      poor_id_status,
                                    ],
                                  },
                                ],
                              },
                              1,
                              0,
                            ],
                          },
                          1,
                        ],
                      },
                      0,
                    ],
                  },
                  0,
                ],
              },
            },
            new_finish_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      {
                        $and: [
                          // {
                          //   $ne: [
                          //     "$courses.students.type_leavel_scholarships",
                          //     controllers.typeLeaveScholarship.status
                          //       .LEAVE_BEFORE_EVALUATE,
                          //   ],
                          // },
                          { $gte: ["$courses.course_end", minToday] },
                          { $lte: ["$courses.course_end", maxToday] },
                        ],
                      },
                      {
                        $cond: [
                          { $ifNull: [poor_id_status, false] },
                          {
                            $cond: [
                              {
                                $and: [
                                  {
                                    $in: [
                                      "$courses.students.poor_status",
                                      poor_id_status,
                                    ],
                                  },
                                ],
                              },
                              1,
                              0,
                            ],
                          },
                          1,
                        ],
                      },
                      0,
                    ],
                  },
                  0,
                ],
              },
            },
            new_employment: {
              $sum: {
                $cond: [
                  { $ifNull: ["$courses.students.student_occupations", false] },
                  {
                    $cond: [
                      {
                        $and: [{ $gte: ["$courses.course_end", minToday] }],
                      },
                      {
                        $cond: [
                          { $ifNull: [poor_id_status, false] },
                          {
                            $cond: [
                              {
                                $and: [
                                  {
                                    $in: [
                                      "$courses.students.poor_status",
                                      poor_id_status,
                                    ],
                                  },
                                ],
                              },
                              1,
                              0,
                            ],
                          },
                          1,
                        ],
                      },
                      0,
                    ],
                  },
                  0,
                ],
              },
            },
            new_employment_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ifNull: [
                          "$courses.students.student_occupations",
                          false,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      {
                        $and: [{ $gte: ["$courses.course_end", minToday] }],
                      },
                      {
                        $cond: [
                          { $ifNull: [poor_id_status, false] },
                          {
                            $cond: [
                              {
                                $and: [
                                  {
                                    $in: [
                                      "$courses.students.poor_status",
                                      poor_id_status,
                                    ],
                                  },
                                ],
                              },
                              1,
                              0,
                            ],
                          },
                          1,
                        ],
                      },
                      0,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_before_evaluate: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $lt: [
                          "$courses.course_end",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            quit_before_evaluate_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.QUIT,
                        ],
                      },
                      {
                        $lt: [
                          "$courses.course_end",
                          "$courses.students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            doing_internship: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ifNull: [
                          "$courses.students.student_internships",
                          false,
                        ],
                      },
                      {
                        $gte: [
                          "$courses.students.student_internships.end_date",
                          minToday,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            doing_internship_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ifNull: [
                          "$courses.students.student_internships",
                          false,
                        ],
                      },
                      {
                        $gte: [
                          "$courses.students.student_internships.end_date",
                          minToday,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  {
                    $cond: [
                      { $ifNull: [poor_id_status, false] },
                      {
                        $cond: [
                          {
                            $and: [
                              {
                                $in: [
                                  "$courses.students.poor_status",
                                  poor_id_status,
                                ],
                              },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                      1,
                    ],
                  },
                  0,
                ],
              },
            },
            waiting_approval: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.REQUESTING,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            waiting_approval_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            reject_during_waiting_approval: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.REJECTED,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            reject_during_waiting_approval_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$courses.students.request_timelines._id",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: [
                          "$courses.students.gender",
                          EnumConstant.Gender.FEMALE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $lookup: {
            from: "courses",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$apply_majors", "$$id"] },
                  status: { $ne: EnumConstant.DELETE },
                  ...matchCourse,
                },
              },
              {
                $group: {
                  _id: null,
                  course_new: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$course_start", minToday] },
                            { $lte: ["$course_start", maxToday] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  course_studying: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $lt: ["$course_start", maxToday] },
                            { $gt: ["$course_end", minToday] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  course_finish: {
                    $sum: {
                      $cond: [
                        {
                          $and: [{ $lt: ["$course_end", minToday] }],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  new_course_finish: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$course_end", minToday] },
                            { $lte: ["$course_end", maxToday] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            as: "courses",
          },
        },
        {
          $unwind: { path: "$courses", preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            course_new: {
              $cond: [
                { $ifNull: ["$courses.course_new", false] },
                "$courses.course_new",
                0,
              ],
            },
            course_studying: {
              $cond: [
                { $ifNull: ["$courses.course_studying", false] },
                "$courses.course_studying",
                0,
              ],
            },
            course_finish: {
              $cond: [
                { $ifNull: ["$courses.course_finish", false] },
                "$courses.course_finish",
                0,
              ],
            },
            new_course_finish: {
              $cond: [
                { $ifNull: ["$courses.new_course_finish", false] },
                "$courses.new_course_finish",
                0,
              ],
            },
          },
        },
        { $sort: { code: 1 } },
        {
          $group: {
            _id: "$sectors",
            apply_majors: { $push: "$$ROOT" },
            scholarship_approved_student: {
              $sum: "$scholarship_approved_student",
            },
            scholarship_approved_student_female: {
              $sum: "$scholarship_approved_student_female",
            },
            quit_before_studying: { $sum: "$quit_before_studying" },
            quit_before_studying_female: {
              $sum: "$quit_before_studying_female",
            },
            quit_during_studying: { $sum: "$quit_during_studying" },
            quit_during_studying_female: {
              $sum: "$quit_during_studying_female",
            },
            quit_during_studying_not_enough_document: {
              $sum: "$quit_during_studying_not_enough_document",
            },
            quit_during_studying_not_enough_document_female: {
              $sum: "$quit_during_studying_not_enough_document_female",
            },
            waiting_studying: { $sum: "$waiting_studying" },
            waiting_studying_female: { $sum: "$waiting_studying_female" },
            new_waiting_studying: { $sum: "$new_waiting_studying" },
            new_waiting_studying_female: {
              $sum: "$new_waiting_studying_female",
            },
            studying: { $sum: "$studying" },
            studying_female: { $sum: "$studying_female" },
            id_poor_studying: { $sum: "$id_poor_studying" },
            id_poor_studying_female: { $sum: "$id_poor_studying_female" },
            finish_studying: { $sum: "$finish_studying" },
            finish_studying_female: { $sum: "$finish_studying_female" },
            internship: { $sum: "$internship" },
            internship_female: { $sum: "$internship_female" },
            employment: { $sum: "$employment" },
            employment_female: { $sum: "$employment_female" },
            new_study: { $sum: "$new_study" },
            new_study_female: { $sum: "$new_study_female" },
            course_new: { $sum: "$course_new" },
            course_studying: { $sum: "$course_studying" },
            new_internship: {
              $sum: "$new_internship",
            },
            new_internship_female: {
              $sum: "$new_internship_female",
            },
            new_finish_studying: {
              $sum: "$new_finish_studying",
            },
            new_finish_studying_female: {
              $sum: "$new_finish_studying_female",
            },
            new_course_finish: {
              $sum: "$new_course_finish",
            },
            course_finish: {
              $sum: "$course_finish",
            },
            new_employment: {
              $sum: "$new_employment",
            },
            new_employment_female: {
              $sum: "$new_employment_female",
            },
            student_apply: {
              $sum: "$student_apply",
            },
            student_female_apply: {
              $sum: "$student_female_apply",
            },
            quit_before_evaluate: {
              $sum: "$quit_before_evaluate",
            },
            quit_before_evaluate_female: {
              $sum: "$quit_before_evaluate_female",
            },
            doing_internship: {
              $sum: "$doing_internship",
            },
            doing_internship_female: {
              $sum: "$doing_internship_female",
            },
            waiting_approval: {
              $sum: "$waiting_approval",
            },
            waiting_approval_female: {
              $sum: "$waiting_approval_female",
            },
            reject_during_waiting_approval: {
              $sum: "$reject_during_waiting_approval",
            },
            reject_during_waiting_approval_female: {
              $sum: "$reject_during_waiting_approval_female",
            },
          },
        },
        {
          $lookup: {
            from: "sectors",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                },
              },
            ],
            as: "sectors",
          },
        },
        {
          $unwind: { path: "$sectors", preserveNullAndEmptyArrays: true },
        },
        {
          $addFields: {
            name: "$sectors.name",
            name_en: "$sectors.name_en",
            code: "$sectors.code",
          },
        },
        {
          $sort: {
            code: 1,
          },
        },
        {
          $project: {
            sectors: 0,
          },
        },
      ])
      .allowDiskUse(true);
    // return data;
    let jsonData = CommonUtil.JSONParse(data);
    let keyToRemove = [
      "quit_during_studying_not_enough_document",
      "quit_during_studying_not_enough_document_female",
      "id_poor_studying",
      "id_poor_studying_female",
      "course_new",
      "course_studying",
      "scholarship_approved_student",
      "scholarship_approved_student_female",
      "waiting_studying",
      "waiting_studying_female",
      "quit_before_studying",
      "quit_before_studying_female",
      "studying",
      "studying_female",
      "quit_during_studying",
      "quit_during_studying_female",
      "internship",
      "internship_female",
      "finish_studying",
      "finish_studying_female",
      "employment",
      "employment_female",
      "new_study_female",
      "new_study",
      "new_waiting_studying",
      "new_waiting_studying_female",
      "new_internship",
      "new_internship_female",
      "new_finish_studying",
      "new_finish_studying_female",
      "new_employment",
      "new_employment_female",
      "new_course_finish",
      "course_finish",
      "student_apply",
      "student_female_apply",
      "quit_before_evaluate",
      "quit_before_evaluate_female",
      "doing_internship",
      "doing_internship_female",
      "waiting_approval",
      "waiting_approval_female",
      "reject_during_waiting_approval",
      "reject_during_waiting_approval_female",
    ];
    let headerColumns: any[] = [];
    let headerTitle: any = [
      "សិស្សដែលបានចុះឈ្មោះចូលរៀន",
      "រង់ចាំអនុម័ត",
      "ចំនួនសិស្សបដិសេធ",
      "ចំនួនសិស្សអនុម័ត",
      "រង់ចាំចូលរៀនថ្មីថ្ងៃនេះ",
      "រងចាំចូលរៀន",
      "បោះបង់មុនចូលរៀន",
      "បោះបង់មុនពេលធ្វើតេស្តវាយតម្លៃ",
      "ចូលរៀនថ្មីថ្ងៃនេះ",
      "កំពុងរៀន",
      "បោះបង់ពេលរៀន",
      "បោះបង់ពេលរៀនខ្វះឯកសារ",
      "កម្មសិក្សាថ្មីថ្ងៃនេះ",
      "បានចុះកម្មសិក្សា",
      "កំពុងចុះកម្មសិក្សា",
      "បានបញ្ចប់ការសិក្សា",
      "ទទួលបានការងារ",
      "បានបញ្ចប់ការសិក្សាថ្មីថ្ងៃនេះ",
      "ទទួលបានការងារថ្មីថ្ងៃនេះ",
      "វគ្គសិក្សា",
    ]; //,"កំពុងរៀន(មានប័ណ្ណ)"
    for (var i = 0; i < headerTitle.length; i++) {
      headerColumns.push({ _id: i + 1, name: headerTitle[i] });
    }
    for (var i = 0; i < jsonData.length; i++) {
      for (var major = 0; major < jsonData[i].apply_majors.length; major++) {
        let studentData: any[] = [];
        let sch = jsonData[i].apply_majors[major];
        studentData.push({
          _id: 1,
          total_student: sch.student_apply,
          total_female: sch.student_female_apply,
        });
        studentData.push({
          _id: 2,
          total_student: sch.waiting_approval,
          total_female: sch.waiting_approval_female,
        });
        studentData.push({
          _id: 3,
          total_student: sch.reject_during_waiting_approval,
          total_female: sch.reject_during_waiting_approval_female,
        });
        studentData.push({
          _id: 4,
          total_student: sch.scholarship_approved_student,
          total_female: sch.scholarship_approved_student_female,
        });
        studentData.push({
          _id: 5,
          total_student: sch.new_waiting_studying,
          total_female: sch.new_waiting_studying_female,
        });
        studentData.push({
          _id: 6,
          total_student: sch.waiting_studying,
          total_female: sch.waiting_studying_female,
        });
        studentData.push({
          _id: 7,
          total_student: sch.quit_before_studying,
          total_female: sch.quit_before_studying_female,
        });
        studentData.push({
          _id: 8,
          total_student: sch.quit_before_evaluate,
          total_female: sch.quit_before_evaluate_female,
        });
        studentData.push({
          _id: 9,
          total_student: sch.new_study,
          total_female: sch.new_study_female,
        });
        studentData.push({
          _id: 10,
          total_student: sch.studying,
          total_female: sch.studying_female,
        });
        // studentData.push({ _id: 7, total_student: sch.id_poor_studying, total_female: sch.id_poor_studying_female });
        studentData.push({
          _id: 11,
          total_student: sch.quit_during_studying,
          total_female: sch.quit_during_studying_female,
        });
        studentData.push({
          _id: 12,
          total_student: sch.quit_during_studying_not_enough_document,
          total_female: sch.quit_during_studying_not_enough_document_female,
        });
        studentData.push({
          _id: 13,
          total_student: sch.new_internship,
          total_female: sch.new_internship_female,
        });
        studentData.push({
          _id: 14,
          total_student: sch.internship,
          total_female: sch.internship_female,
        });
        studentData.push({
          _id: 15,
          total_student: sch.doing_internship,
          total_female: sch.doing_internship_female,
        });
        studentData.push({
          _id: 16,
          total_student: sch.finish_studying,
          total_female: sch.finish_studying_female,
          total_course_finish: sch.course_finish,
        });
        studentData.push({
          _id: 17,
          total_student: sch.employment,
          total_female: sch.employment_female,
        });
        studentData.push({
          _id: 18,
          total_student: sch.new_finish_studying,
          total_female: sch.new_finish_studying_female,
          total_new_course_finish: sch.new_course_finish,
        });
        studentData.push({
          _id: 19,
          total_student: sch.new_employment,
          total_female: sch.new_employment_female,
        });
        studentData.push({
          _id: 20,
          total_student: sch.course_studying,
          total_female: sch.course_new,
        });

        jsonData[i].apply_majors[major].student_data = studentData;
        jsonData[i].apply_majors[major] = CommonUtil.removeKeys(
          jsonData[i].apply_majors[major],
          keyToRemove
        );
      }
      let studentData: any[] = [];
      let city = jsonData[i];
      studentData.push({
        _id: 1,
        total_student: city.student_apply,
        total_female: city.student_female_apply,
      });
      studentData.push({
        _id: 2,
        total_student: city.waiting_approval,
        total_female: city.waiting_approval_female,
      });
      studentData.push({
        _id: 3,
        total_student: city.reject_during_waiting_approval,
        total_female: city.reject_during_waiting_approval_female,
      });
      studentData.push({
        _id: 4,
        total_student: city.scholarship_approved_student,
        total_female: city.scholarship_approved_student_female,
      });
      studentData.push({
        _id: 5,
        total_student: city.new_waiting_studying,
        total_female: city.new_waiting_studying_female,
      });
      studentData.push({
        _id: 6,
        total_student: city.waiting_studying,
        total_female: city.waiting_studying_female,
      });
      studentData.push({
        _id: 7,
        total_student: city.quit_before_studying,
        total_female: city.quit_before_studying_female,
      });
      studentData.push({
        _id: 8,
        total_student: city.quit_before_evaluate,
        total_female: city.quit_before_evaluate_female,
      });
      studentData.push({
        _id: 9,
        total_student: city.new_study,
        total_female: city.new_study_female,
      });
      studentData.push({
        _id: 10,
        total_student: city.studying,
        total_female: city.studying_female,
      });
      // studentData.push({ _id: 7, total_student: city.id_poor_studying, total_female: city.id_poor_studying_female });
      studentData.push({
        _id: 11,
        total_student: city.quit_during_studying,
        total_female: city.quit_during_studying_female,
      });
      studentData.push({
        _id: 12,
        total_student: city.quit_during_studying_not_enough_document,
        total_female: city.quit_during_studying_not_enough_document_female,
      });
      studentData.push({
        _id: 13,
        total_student: city.new_internship,
        total_female: city.new_internship_female,
      });
      studentData.push({
        _id: 14,
        total_student: city.internship,
        total_female: city.internship_female,
      });
      studentData.push({
        _id: 15,
        total_student: city.doing_internship,
        total_female: city.doing_internship_female,
      });
      studentData.push({
        _id: 16,
        total_student: city.finish_studying,
        total_female: city.finish_studying_female,
        total_course_finish: city.course_finish,
      });
      studentData.push({
        _id: 17,
        total_student: city.employment,
        total_female: city.employment_female,
      });
      studentData.push({
        _id: 18,
        total_student: city.new_finish_studying,
        total_female: city.new_finish_studying_female,
        total_new_course_finish: city.new_course_finish,
      });
      studentData.push({
        _id: 19,
        total_student: city.new_employment,
        total_female: city.new_employment_female,
      });
      studentData.push({
        _id: 20,
        total_student: city.course_studying,
        total_female: city.course_new,
      });
      jsonData[i].student_data = studentData;
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
    }

    return {
      // start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_data: this.totalValue(headerColumns, jsonData),
    };
  }

  async getWeeklyReport(req: any) {
    let {
      apply_majors,
      shifts,
      schools,
      poor_status,
      type_poverty_status,
      page,
      limit,
    } = req.query;
    let endDate = new Date(req.query.end_date);

    let query: any = {
      status: { $ne: EnumConstant.DELETE },
      createdAt: { $lte: endDate },
    };
    if (apply_majors) {
      query._id = new ObjectId(apply_majors);
    }
    if (schools) {
      query.schools = new ObjectId(schools);
    }
    if (req.body._user.schools) {
      query.schools = new ObjectId(req.body._user.schools);
    }
    let queryTimelineType = EnumConstant.TimelineType.SCHOLARSHIP;
    let matchPoor: any = {};
    if (poor_status) {
      matchPoor.poor_status = Number(poor_status);
      // queryTimelineType = EnumConstant.TimelineType.IDPOOR
    }
    if (type_poverty_status) {
      if (type_poverty_status == EnumConstant.TypePovertyStatus.NOT_POOR) {
        matchPoor.type_poverty_status = { $in: [type_poverty_status, null] };
      } else {
        matchPoor.type_poverty_status = type_poverty_status;
      }
    }
    let minToday = new Date(new Date(req.query.end_date).setHours(0, 0, 0));
    let maxToday = new Date(new Date(req.query.end_date).setHours(23, 59, 59));

    let currentDate = new Date(Date.now());

    page = parseInt(page) || 1;
    limit = parseInt(limit) || 100;

    let skipCount = (page - 1) * limit;

    let totalCount = await models.course.countDocuments(query);
    let data = await models.course
      .aggregate([
        {
          $match: query,
        },
        {
          $skip: skipCount,
        },
        {
          $limit: limit,
        },
        {
          $lookup: {
            from: "skills",
            let: { majorId: "$apply_majors" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: ["$_id", "$$majorId"],
                  },
                },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  name_en: 1,
                  code: 1,
                },
              },
            ],
            as: "apply_majors",
          },
        },
        {
          $unwind: {
            path: "$apply_majors",
          },
        },
        {
          $lookup: {
            from: "schools",
            let: { schoolId: "$schools" },
            pipeline: [
              {
                $match: { $expr: { $eq: ["$_id", "$$schoolId"] } },
              },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  name_en: 1,
                  code: 1,
                },
              },
              {
                $lookup: {
                  from: "score_pass_fails",
                  let: { schoolId: "$_id" },
                  pipeline: [
                    {
                      $match: { $expr: { $eq: ["$schools", "$$schoolId"] } },
                    },
                  ],
                  as: "score_pass_fails",
                },
              },
            ],
            as: "schools",
          },
        },
        {
          $unwind: { path: "$schools" },
        },
        {
          $set: {
            school_score: {
              $arrayElemAt: ["$schools.score_pass_fails.pass_score", 0],
            },
          },
        },
        {
          $lookup: {
            from: "students",
            let: { id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$courses", "$$id"] },
                },
              },
              {
                $lookup: {
                  from: "request_timelines",
                  let: {
                    id: "$_id",
                  },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        timeline_type: queryTimelineType,
                        createdAt: { $lte: endDate },
                      },
                    },
                    { $sort: { createdAt: -1 } },
                    { $limit: 1 },
                    {
                      $project: {
                        _id: {
                          $cond: {
                            if: {
                              $eq: ["$status", EnumConstant.RESUME_STUDY],
                            },
                            then: EnumConstant.ACTIVE,
                            else: "$status",
                          },
                        },
                        createdAt: 1,
                      },
                    },
                  ],
                  as: "request_timelines",
                },
              },
              {
                $unwind: {
                  path: "$request_timelines",
                },
              },
              {
                $lookup: {
                  from: "scores",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        is_final_score: true,
                      },
                    },
                  ],
                  as: "scores",
                },
              },
              {
                $set: {
                  student_total_score: {
                    $arrayElemAt: ["$scores.total_score", 0],
                  },
                },
              },
              {
                $lookup: {
                  from: "student_internships",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        status: EnumConstant.ACTIVE,
                        start_date: { $lte: endDate },
                      },
                    },
                    { $limit: 1 },
                  ],
                  as: "student_internships",
                },
              },
              {
                $unwind: {
                  path: "$student_internships",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "student_occupations",
                  let: { id: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$id"],
                        },
                        status: EnumConstant.ACTIVE,
                        has_job: EnumConstant.ACTIVE,
                      },
                    },
                    { $limit: 1 },
                  ],
                  as: "student_occupations",
                },
              },
              {
                $unwind: {
                  path: "$student_occupations",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $lookup: {
                  from: "attendance_students",
                  let: { studentId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: ["$students", "$$studentId"],
                        },
                      },
                    },
                  ],
                  as: "average_attendance",
                },
              },
              {
                $addFields: {
                  average_attendance: {
                    $avg: "$average_attendance.attendance_score",
                  },
                },
              },
              {
                $project: {
                  first_name: 1,
                  last_name: 1,
                  courses: 1,
                  createdAt: 1,
                  gender: 1,
                  poor_id: 1,
                  poor_member_uuid: 1,
                  poor_status: 1,
                  request_timelines: 1,
                  scholarship_status: 1,
                  schools: 1,
                  status: 1,
                  type_poverty_status: 1,
                  type_projects: 1,
                  scores: 1,
                  student_total_score: 1,
                  type_leavel_scholarships: 1,
                  average_attendance: 1,
                  student_internships: 1,
                  student_occupations: 1,
                },
              },
            ],
            as: "students",
          },
        },
        { $unwind: { path: "$students", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: "$_id",
            name: { $first: "$apply_majors.name" },
            name_en: { $first: "$apply_majors.name_en" },
            code: { $first: "$apply_majors.code" },
            schoolId: { $first: "$schools._id" },
            school: { $first: "$schools.name" },
            course_start: { $first: "$course_start" },
            course_end: { $first: "$course_end" },
            // Register Student
            total_student_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $lte: ["$students.createdAt", endDate] },
                      { $ifNull: ["$students", false] },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            student_register_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_register_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_poor_1_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_female_poor_1_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_male_poor_1_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_poor_2_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_female_poor_2_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_male_poor_2_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_near_poor_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_female_near_poor_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_male_near_poor_register: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      { $eq: ["$students.status", EnumConstant.ACTIVE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_not_poor_register: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                          { $ifNull: ["$students", false] },
                          { $eq: ["$students.status", EnumConstant.ACTIVE] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            student_female_not_poor_register: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                          {
                            $eq: ["$students.gender", "female"],
                          },
                          { $eq: ["$students.status", EnumConstant.ACTIVE] },
                        ],
                      },

                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            student_male_not_poor_register: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: ["$students.gender", "male"],
                          },
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                          { $eq: ["$students.status", EnumConstant.ACTIVE] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // NOT_ENOUGH_DOC Students
            total_not_enough_doc_student: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_not_enough_doc_student_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_not_enough_doc_student_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_not_enough_doc_student_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            not_enough_doc_student_female_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            not_enough_doc_student_male_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_not_enough_doc_student_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            not_enough_doc_student_female_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            not_enough_doc_student_male_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_not_enough_doc_student_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            not_enough_doc_student_female_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            not_enough_doc_student_male_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_not_enough_doc_student_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                          {
                            $eq: [
                              "$students.type_leavel_scholarships",
                              controllers.typeLeaveScholarship.status
                                .NOT_ENOUGH_DOCUMENT,
                            ],
                          },
                        ],
                      },

                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            not_enough_doc_student_female_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                          {
                            $eq: [
                              "$students.type_leavel_scholarships",
                              controllers.typeLeaveScholarship.status
                                .NOT_ENOUGH_DOCUMENT,
                            ],
                          },
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            not_enough_doc_student_male_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                          {
                            $eq: [
                              "$students.type_leavel_scholarships",
                              controllers.typeLeaveScholarship.status
                                .NOT_ENOUGH_DOCUMENT,
                            ],
                          },
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // Approve Students
            total_student_approve: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                      {
                        $ifNull: ["$students", false],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_female_approve: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_male_approve: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_approve_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_female_approve_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_male_approve_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_approve_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_female_approve_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_male_approve_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_approve_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_female_approve_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_male_approve_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REQUESTING,
                        ],
                      },
                      {
                        $ne: [
                          "$students.scholarship_status",
                          EnumConstant.REJECTED,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $lte: ["$students.createdAt", endDate],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            student_approve_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $ne: [
                              "$students.scholarship_status",
                              EnumConstant.REQUESTING,
                            ],
                          },
                          {
                            $ne: [
                              "$students.scholarship_status",
                              EnumConstant.REJECTED,
                            ],
                          },
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                          { $ifNull: ["$students", false] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            student_female_approve_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $ne: [
                              "$students.scholarship_status",
                              EnumConstant.REQUESTING,
                            ],
                          },
                          {
                            $ne: [
                              "$students.scholarship_status",
                              EnumConstant.REJECTED,
                            ],
                          },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                          { $ifNull: ["$students", false] },
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            student_male_approve_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $ne: [
                              "$students.scholarship_status",
                              EnumConstant.REQUESTING,
                            ],
                          },
                          {
                            $ne: [
                              "$students.scholarship_status",
                              EnumConstant.REJECTED,
                            ],
                          },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                          {
                            $lte: ["$students.createdAt", endDate],
                          },
                          { $ifNull: ["$students", false] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // Quit During Study
            total_quit_during_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_quit_during_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_quit_during_studying_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_quit_during_studying_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            quit_during_studying_poor_1_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            quit_during_studying_poor_1_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_quit_during_studying_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            quit_during_studying_poor_2_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            quit_during_studying_poor_2_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_quit_during_studying_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            quit_during_studying_near_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            quit_during_studying_near_poor_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $ne: [
                          "$students.type_leavel_scholarships",
                          controllers.typeLeaveScholarship.status
                            .NOT_ENOUGH_DOCUMENT,
                        ],
                      },
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [
                            EnumConstant.QUIT,
                            controllers.typeLeaveScholarship.status
                              .LEAVE_BEFORE_EVALUATE,
                          ],
                        ],
                      },
                      {
                        $lte: [
                          "$course_start",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $gte: [
                          "$course_end",
                          "$students.request_timelines.createdAt",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_quit_during_studying_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students", false] },
                          {
                            $ne: [
                              "$students.type_leavel_scholarships",
                              controllers.typeLeaveScholarship.status
                                .NOT_ENOUGH_DOCUMENT,
                            ],
                          },
                          {
                            $in: [
                              "$students.request_timelines._id",
                              [
                                EnumConstant.QUIT,
                                controllers.typeLeaveScholarship.status
                                  .LEAVE_BEFORE_EVALUATE,
                              ],
                            ],
                          },
                          {
                            $lte: [
                              "$course_start",
                              "$students.request_timelines.createdAt",
                            ],
                          },
                          {
                            $gte: [
                              "$course_end",
                              "$students.request_timelines.createdAt",
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            quit_during_studying_not_poor_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students", false] },

                          {
                            $ne: [
                              "$students.type_leavel_scholarships",
                              controllers.typeLeaveScholarship.status
                                .NOT_ENOUGH_DOCUMENT,
                            ],
                          },
                          {
                            $in: [
                              "$students.request_timelines._id",
                              [
                                EnumConstant.QUIT,
                                controllers.typeLeaveScholarship.status
                                  .LEAVE_BEFORE_EVALUATE,
                              ],
                            ],
                          },
                          {
                            $lte: [
                              "$course_start",
                              "$students.request_timelines.createdAt",
                            ],
                          },
                          {
                            $gte: [
                              "$course_end",
                              "$students.request_timelines.createdAt",
                            ],
                          },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            quit_during_studying_not_poor_male: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students", false] },

                          {
                            $ne: [
                              "$students.type_leavel_scholarships",
                              controllers.typeLeaveScholarship.status
                                .NOT_ENOUGH_DOCUMENT,
                            ],
                          },
                          {
                            $in: [
                              "$students.request_timelines._id",
                              [
                                EnumConstant.QUIT,
                                controllers.typeLeaveScholarship.status
                                  .LEAVE_BEFORE_EVALUATE,
                              ],
                            ],
                          },
                          {
                            $lte: [
                              "$course_start",
                              "$students.request_timelines.createdAt",
                            ],
                          },
                          {
                            $gte: [
                              "$course_end",
                              "$students.request_timelines.createdAt",
                            ],
                          },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            // Studing
            total_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_studying_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_studying_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            studying_poor_1_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            studying_poor_1_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_studying_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            studying_poor_2_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            studying_poor_2_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_studying_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            studying_near_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            studying_near_poor_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_studying_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $lt: ["$course_start", maxToday] },
                          { $gt: ["$course_end", minToday] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            studying_not_poor_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $lt: ["$course_start", maxToday] },
                          { $gt: ["$course_end", minToday] },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            studying_not_poor_male: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $lt: ["$course_start", maxToday] },
                          { $gt: ["$course_end", minToday] },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // Attendance under 80%
            total_attendance_student: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_attendance_student_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_attendance_student_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_attendance_student_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            attendance_student_poor_1_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            attendance_student_poor_1_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_attendance_student_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            attendance_student_poor_2_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            attendance_student_poor_2_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_attendance_student_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            attendance_student_near_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            attendance_student_near_poor_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $in: [
                          "$students.request_timelines._id",
                          [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                        ],
                      },
                      {
                        $lt: ["$students.average_attendance", 80],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      { $lt: ["$course_start", maxToday] },
                      { $gt: ["$course_end", minToday] },
                      {
                        $eq: [
                          "$students.scholarship_status",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $ne: ["$students.average_attendance", null] },
                      { $ne: ["$students.average_attendance", 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_attendance_student_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $in: [
                              "$students.request_timelines._id",
                              [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                            ],
                          },
                          {
                            $lt: ["$students.average_attendance", 80],
                          },
                          { $lt: ["$course_start", maxToday] },
                          { $gt: ["$course_end", minToday] },
                          {
                            $eq: [
                              "$students.scholarship_status",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $ne: ["$students.average_attendance", null] },
                          { $ne: ["$students.average_attendance", 0] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            attendance_student_not_poor_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $in: [
                              "$students.request_timelines._id",
                              [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                            ],
                          },
                          {
                            $lt: ["$students.average_attendance", 80],
                          },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                          { $lt: ["$course_start", maxToday] },
                          { $gt: ["$course_end", minToday] },
                          {
                            $eq: [
                              "$students.scholarship_status",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $ne: ["$students.average_attendance", null] },
                          { $ne: ["$students.average_attendance", 0] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            attendance_student_not_poor_male: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $in: [
                              "$students.request_timelines._id",
                              [EnumConstant.ACTIVE, EnumConstant.RESUME_STUDY],
                            ],
                          },
                          {
                            $lt: ["$students.average_attendance", 80],
                          },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                          { $lt: ["$course_start", maxToday] },
                          { $gt: ["$course_end", minToday] },
                          {
                            $eq: [
                              "$students.scholarship_status",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $ne: ["$students.average_attendance", null] },
                          { $ne: ["$students.average_attendance", 0] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // Internship
            total_internship: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_internship_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_internship_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_internship_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            internship_poor_1_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            internship_poor_1_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_internship_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            internship_poor_2_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            internship_poor_2_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_internship_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            internship_near_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            internship_near_poor_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_internships", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                      {
                        $gt: [
                          "$students.student_internships.end_date",
                          maxToday,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_internship_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students.student_internships", false] },
                          {
                            $gt: [
                              "$students.student_internships.end_date",
                              maxToday,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            internship_not_poor_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students.student_internships", false] },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                          {
                            $gt: [
                              "$students.student_internships.end_date",
                              maxToday,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            internship_not_poor_male: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students.student_internships", false] },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                          {
                            $gt: [
                              "$students.student_internships.end_date",
                              maxToday,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // Finish Study
            total_finish_studying: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_finish_studying_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_finish_studying_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_finish_studying_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            finish_studying_poor_1_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            finish_studying_poor_1_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_finish_studying_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            finish_studying_poor_2_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            finish_studying_poor_2_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_finish_studying_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            finish_studying_near_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            finish_studying_near_poor_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      { $lt: ["$course_end", minToday] },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                      {
                        $ne: [
                          "$students.request_timelines._id",
                          controllers.typeLeaveScholarship.status
                            .LEAVE_BEFORE_EVALUATE,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_finish_studying_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $lt: ["$course_end", minToday] },
                          {
                            $ne: [
                              "$students.request_timelines._id",
                              controllers.typeLeaveScholarship.status
                                .LEAVE_BEFORE_EVALUATE,
                            ],
                          },
                        ],
                      },

                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            finish_studying_not_poor_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $lt: ["$course_end", minToday] },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                          {
                            $ne: [
                              "$students.request_timelines._id",
                              controllers.typeLeaveScholarship.status
                                .LEAVE_BEFORE_EVALUATE,
                            ],
                          },
                        ],
                      },

                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            finish_studying_not_poor_male: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          { $lt: ["$course_end", minToday] },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                          {
                            $ne: [
                              "$students.request_timelines._id",
                              controllers.typeLeaveScholarship.status
                                .LEAVE_BEFORE_EVALUATE,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },

            // Pass exam student
            total_student_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_female_student_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_male_student_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_poor_1_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            female_student_poor_1_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            male_student_poor_1_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_poor_2_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            female_student_poor_2_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            male_student_poor_2_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_near_poor_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            female_student_near_poor_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            male_student_near_poor_pass: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      {
                        $eq: [
                          "$students.request_timelines._id",
                          EnumConstant.ACTIVE,
                        ],
                      },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $gte: [
                          "$students.student_total_score",
                          "$school_score",
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_student_not_poor_pass: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          {
                            $gte: [
                              "$students.student_total_score",
                              "$school_score",
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            female_student_not_poor_pass: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          {
                            $gte: [
                              "$students.student_total_score",
                              "$school_score",
                            ],
                          },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            male_student_not_poor_pass: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              "$students.request_timelines._id",
                              EnumConstant.ACTIVE,
                            ],
                          },
                          {
                            $gte: [
                              "$students.student_total_score",
                              "$school_score",
                            ],
                          },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            // Employment
            total_employment: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.student_occupations", false] },
                  1,
                  0,
                ],
              },
            },
            total_employment_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      { $eq: ["$students.gender", EnumConstant.Gender.FEMALE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_employment_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      { $eq: ["$students.gender", EnumConstant.Gender.MALE] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_employment_poor_1: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            employment_poor_1_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            employment_poor_1_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_1,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_employment_poor_2: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            employment_poor_2_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            employment_poor_2_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.POOR_2,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_employment_near_poor: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            employment_near_poor_female: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.FEMALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            employment_near_poor_male: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ifNull: ["$students.student_occupations", false] },
                      {
                        $eq: [
                          "$students.type_poverty_status",
                          EnumConstant.TypePovertyStatus.NEAR_POOR,
                        ],
                      },
                      {
                        $eq: ["$students.gender", EnumConstant.Gender.MALE],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            total_employment_not_poor: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      { $ifNull: ["$students.student_occupations", false] },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            employment_not_poor_female: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students.student_occupations", false] },
                          {
                            $eq: [
                              "$students.gender",
                              EnumConstant.Gender.FEMALE,
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
            employment_not_poor_male: {
              $sum: {
                $cond: [
                  { $ifNull: ["$students.poor_id", false] },
                  0,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ifNull: ["$students.student_occupations", false] },
                          {
                            $eq: ["$students.gender", EnumConstant.Gender.MALE],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                ],
              },
            },
          },
        },
        { $sort: { code: 1 } },
      ])
      .allowDiskUse(true);

    let jsonData = CommonUtil.JSONParse(data);
    let keyToRemove = [
      "total_student_register",
      "student_register_female",
      "student_register_male",
      "total_student_poor_1_register",
      "student_female_poor_1_register",
      "student_male_poor_1_register",
      "total_student_poor_2_register",
      "student_female_poor_2_register",
      "student_male_poor_2_register",
      "total_student_near_poor_register",
      "student_female_near_poor_register",
      "student_male_near_poor_register",
      "total_student_not_poor_register",
      "student_female_not_poor_register",
      "student_male_not_poor_register",
      "total_not_enough_doc_student",
      "total_not_enough_doc_student_female",
      "total_not_enough_doc_student_male",
      "total_not_enough_doc_student_poor_1",
      "not_enough_doc_student_female_poor_1",
      "not_enough_doc_student_male_poor_1",
      "total_not_enough_doc_student_poor_2",
      "not_enough_doc_student_female_poor_2",
      "not_enough_doc_student_male_poor_2",
      "total_not_enough_doc_student_near_poor",
      "not_enough_doc_student_female_near_poor",
      "not_enough_doc_student_male_near_poor",
      "total_not_enough_doc_student_not_poor",
      "not_enough_doc_student_female_not_poor",
      "not_enough_doc_student_male_not_poor",
      "total_student_approve",
      "total_student_female_approve",
      "total_student_male_approve",
      "student_approve_poor_1",
      "student_female_approve_poor_1",
      "student_male_approve_poor_1",
      "student_approve_poor_2",
      "student_female_approve_poor_2",
      "student_male_approve_poor_2",
      "total_student_approve_near_poor",
      "student_female_approve_near_poor",
      "student_male_approve_near_poor",
      "student_approve_not_poor",
      "student_female_approve_not_poor",
      "student_male_approve_not_poor",
      "total_quit_during_studying",
      "total_quit_during_studying_female",
      "total_quit_during_studying_male",
      "total_quit_during_studying_poor_1",
      "quit_during_studying_poor_1_female",
      "quit_during_studying_poor_1_male",
      "total_quit_during_studying_poor_2",
      "quit_during_studying_poor_2_female",
      "quit_during_studying_poor_2_male",
      "total_quit_during_studying_near_poor",
      "quit_during_studying_near_poor_female",
      "quit_during_studying_near_poor_male",
      "total_quit_during_studying_not_poor",
      "quit_during_studying_not_poor_female",
      "quit_during_studying_not_poor_male",
      "total_studying",
      "total_studying_female",
      "total_studying_male",
      "total_studying_poor_1",
      "studying_poor_1_female",
      "studying_poor_1_male",
      "total_studying_poor_2",
      "studying_poor_2_female",
      "studying_poor_2_male",
      "total_studying_near_poor",
      "studying_near_poor_female",
      "studying_near_poor_male",
      "total_studying_not_poor",
      "studying_not_poor_female",
      "studying_not_poor_male",
      "total_attendance_student",
      "total_attendance_student_female",
      "total_attendance_student_male",
      "total_attendance_student_poor_1",
      "attendance_student_poor_1_female",
      "attendance_student_poor_1_male",
      "total_attendance_student_poor_2",
      "attendance_student_poor_2_female",
      "attendance_student_poor_2_male",
      "total_attendance_student_near_poor",
      "attendance_student_near_poor_female",
      "attendance_student_near_poor_male",
      "total_attendance_student_not_poor",
      "attendance_student_not_poor_female",
      "attendance_student_not_poor_male",
      "total_internship",
      "total_internship_female",
      "total_internship_male",
      "total_internship_poor_1",
      "internship_poor_1_female",
      "internship_poor_1_male",
      "total_internship_poor_2",
      "internship_poor_2_female",
      "internship_poor_2_male",
      "total_internship_near_poor",
      "internship_near_poor_female",
      "internship_near_poor_male",
      "total_internship_not_poor",
      "internship_not_poor_female",
      "internship_not_poor_male",
      "total_finish_studying",
      "total_finish_studying_female",
      "total_finish_studying_male",
      "total_finish_studying_poor_1",
      "finish_studying_poor_1_female",
      "finish_studying_poor_1_male",
      "total_finish_studying_poor_2",
      "finish_studying_poor_2_female",
      "finish_studying_poor_2_male",
      "total_finish_studying_near_poor",
      "finish_studying_near_poor_female",
      "finish_studying_near_poor_male",
      "total_finish_studying_not_poor",
      "finish_studying_not_poor_female",
      "finish_studying_not_poor_male",
      "total_student_pass",
      "total_female_student_pass",
      "total_male_student_pass",
      "total_student_poor_1_pass",
      "female_student_poor_1_pass",
      "male_student_poor_1_pass",
      "total_student_poor_2_pass",
      "female_student_poor_2_pass",
      "male_student_poor_2_pass",
      "total_student_near_poor_pass",
      "female_student_near_poor_pass",
      "male_student_near_poor_pass",
      "total_student_not_poor_pass",
      "female_student_not_poor_pass",
      "male_student_not_poor_pass",
      "total_employment",
      "total_employment_female",
      "total_employment_male",
      "total_employment_poor_1",
      "employment_poor_1_female",
      "employment_poor_1_male",
      "total_employment_poor_2",
      "employment_poor_2_female",
      "employment_poor_2_male",
      "total_employment_near_poor",
      "employment_near_poor_female",
      "employment_near_poor_male",
      "total_employment_not_poor",
      "employment_not_poor_female",
      "employment_not_poor_male",
    ];
    let headerColumns: any[] = [];
    let headerTitle: any = [
      "ចំនួនចុះឈ្មោះ",
      "មិនគ្រប់លក្ខខណ្ឌ",
      "ចូលសិក្សា(បានអនុម័ត)",
      "បោះបង់ការសិក្សា",
      "កំពុងសិក្សា",
      "វត្តមានក្រោម៨០%",
      "កំពុងកម្មសិក្សា",
      "ប្រឡងបញ្ចប់ការសិក្សា",
      "បញ្ចប់ការសិក្សា (ប្រឡងជាប់)",
      "ទទួលបានការងារ",
    ];
    for (let i = 0; i < headerTitle.length; i++) {
      headerColumns.push({ _id: i + 1, name: headerTitle[i] });
    }

    for (let i = 0; i < jsonData.length; i++) {
      let studentData: any[] = [];
      let sch = jsonData[i];
      studentData.push({
        _id: 1,
        total_student: sch.total_student_register,
        total_student_female: sch.student_register_female,
        total_student_male: sch.student_register_male,
        total_student_poor_1: sch.total_student_poor_1_register,
        total_student_poor_1_female: sch.student_female_poor_1_register,
        total_student_poor_1_male: sch.student_male_poor_1_register,
        total_student_poor_2: sch.total_student_poor_2_register,
        total_student_poor_2_female: sch.student_female_poor_2_register,
        total_student_poor_2_male: sch.student_male_poor_2_register,
        total_student_near_poor: sch.total_student_near_poor_register,
        total_student_near_poor_female: sch.student_female_near_poor_register,
        total_student_near_poor_male: sch.student_male_near_poor_register,
        total_student_not_poor: sch.total_student_not_poor_register,
        total_student_not_poor_female: sch.student_female_not_poor_register,
        total_student_not_poor_male: sch.student_male_not_poor_register,
      });
      studentData.push({
        _id: 2,
        total_student: sch.total_not_enough_doc_student,
        total_student_female: sch.total_not_enough_doc_student_female,
        total_student_male: sch.total_not_enough_doc_student_male,
        total_student_poor_1: sch.total_not_enough_doc_student_poor_1,
        total_student_poor_1_female: sch.not_enough_doc_student_female_poor_1,
        total_student_poor_1_male: sch.not_enough_doc_student_male_poor_1,
        total_student_poor_2: sch.total_not_enough_doc_student_poor_2,
        total_student_poor_2_female: sch.not_enough_doc_student_female_poor_2,
        total_student_poor_2_male: sch.not_enough_doc_student_male_poor_2,
        total_student_near_poor: sch.total_not_enough_doc_student_near_poor,
        total_student_near_poor_female:
          sch.not_enough_doc_student_female_near_poor,
        total_student_near_poor_male: sch.not_enough_doc_student_male_near_poor,
        total_student_not_poor: sch.total_not_enough_doc_student_not_poor,
        total_student_not_poor_female:
          sch.not_enough_doc_student_female_not_poor,
        total_student_not_poor_male: sch.not_enough_doc_student_male_not_poor,
      });
      studentData.push({
        _id: 3,
        total_student: sch.total_student_approve,
        total_student_female: sch.total_student_female_approve,
        total_student_male: sch.total_student_male_approve,
        total_student_poor_1: sch.student_approve_poor_1,
        total_student_poor_1_female: sch.student_female_approve_poor_1,
        total_student_poor_1_male: sch.student_male_approve_poor_1,
        total_student_poor_2: sch.student_approve_poor_2,
        total_student_poor_2_female: sch.student_female_approve_poor_2,
        total_student_poor_2_male: sch.student_male_approve_poor_2,
        total_student_near_poor: sch.total_student_approve_near_poor,
        total_student_near_poor_female: sch.student_female_approve_near_poor,
        total_student_near_poor_male: sch.student_male_approve_near_poor,
        total_student_not_poor: sch.student_approve_not_poor,
        total_student_not_poor_female: sch.student_female_approve_not_poor,
        total_student_not_poor_male: sch.student_male_approve_not_poor,
      });
      studentData.push({
        _id: 4,
        total_student: sch.total_quit_during_studying,
        total_student_female: sch.total_quit_during_studying_female,
        total_student_male: sch.total_quit_during_studying_male,
        total_student_poor_1: sch.total_quit_during_studying_poor_1,
        total_student_poor_1_female: sch.quit_during_studying_poor_1_female,
        total_student_poor_1_male: sch.quit_during_studying_poor_1_male,
        total_student_poor_2: sch.total_quit_during_studying_poor_2,
        total_student_poor_2_female: sch.quit_during_studying_poor_2_female,
        total_student_poor_2_male: sch.quit_during_studying_poor_2_male,
        total_student_near_poor: sch.total_quit_during_studying_near_poor,
        total_student_near_poor_female:
          sch.quit_during_studying_near_poor_female,
        total_student_near_poor_male: sch.quit_during_studying_near_poor_male,
        total_student_not_poor: sch.total_quit_during_studying_not_poor,
        total_student_not_poor_female: sch.quit_during_studying_not_poor_female,
        total_student_not_poor_male: sch.quit_during_studying_not_poor_male,
      });
      studentData.push({
        _id: 5,
        total_student: sch.total_studying,
        total_student_female: sch.total_studying_female,
        total_student_male: sch.total_studying_male,
        total_student_poor_1: sch.total_studying_poor_1,
        total_student_poor_1_female: sch.studying_poor_1_female,
        total_student_poor_1_male: sch.studying_poor_1_male,
        total_student_poor_2: sch.total_studying_poor_2,
        total_student_poor_2_female: sch.studying_poor_2_female,
        total_student_poor_2_male: sch.studying_poor_2_male,
        total_student_near_poor: sch.total_studying_near_poor,
        total_student_near_poor_female: sch.studying_near_poor_female,
        total_student_near_poor_male: sch.studying_near_poor_male,
        total_student_not_poor: sch.total_studying_not_poor,
        total_student_not_poor_female: sch.studying_not_poor_female,
        total_student_not_poor_male: sch.studying_not_poor_male,
      });
      studentData.push({
        _id: 6,
        total_student: sch.total_attendance_student,
        total_student_female: sch.total_attendance_student_female,
        total_student_male: sch.total_attendance_student_male,
        total_student_poor_1: sch.total_attendance_student_poor_1,
        total_student_poor_1_female: sch.attendance_student_poor_1_female,
        total_student_poor_1_male: sch.attendance_student_poor_1_male,
        total_student_poor_2: sch.total_attendance_student_poor_2,
        total_student_poor_2_female: sch.attendance_student_poor_2_female,
        total_student_poor_2_male: sch.attendance_student_poor_2_male,
        total_student_near_poor: sch.total_attendance_student_near_poor,
        total_student_near_poor_female: sch.attendance_student_near_poor_female,
        total_student_near_poor_male: sch.attendance_student_near_poor_male,
        total_student_not_poor: sch.total_attendance_student_not_poor,
        total_student_not_poor_female: sch.attendance_student_not_poor_female,
        total_student_not_poor_male: sch.attendance_student_not_poor_male,
      });
      studentData.push({
        _id: 7,
        total_student: sch.total_internship,
        total_student_female: sch.total_internship_female,
        total_student_male: sch.total_internship_male,
        total_student_poor_1: sch.total_internship_poor_1,
        total_student_poor_1_female: sch.internship_poor_1_female,
        total_student_poor_1_male: sch.internship_poor_1_male,
        total_student_poor_2: sch.total_internship_poor_2,
        total_student_poor_2_female: sch.internship_poor_2_female,
        total_student_poor_2_male: sch.internship_poor_2_male,
        total_student_near_poor: sch.total_internship_near_poor,
        total_student_near_poor_female: sch.internship_near_poor_female,
        total_student_near_poor_male: sch.internship_near_poor_male,
        total_student_not_poor: sch.total_internship_not_poor,
        total_student_not_poor_female: sch.internship_not_poor_female,
        total_student_not_poor_male: sch.internship_not_poor_male,
      });
      studentData.push({
        _id: 8,
        total_student: sch.total_finish_studying,
        total_student_female: sch.total_finish_studying_female,
        total_student_male: sch.total_finish_studying_male,
        total_student_poor_1: sch.total_finish_studying_poor_1,
        total_student_poor_1_female: sch.finish_studying_poor_1_female,
        total_student_poor_1_male: sch.finish_studying_poor_1_male,
        total_student_poor_2: sch.total_finish_studying_poor_2,
        total_student_poor_2_female: sch.finish_studying_poor_2_female,
        total_student_poor_2_male: sch.finish_studying_poor_2_male,
        total_student_near_poor: sch.total_finish_studying_near_poor,
        total_student_near_poor_female: sch.finish_studying_near_poor_female,
        total_student_near_poor_male: sch.finish_studying_near_poor_male,
        total_student_not_poor: sch.total_finish_studying_not_poor,
        total_student_not_poor_female: sch.finish_studying_not_poor_female,
        total_student_not_poor_male: sch.finish_studying_not_poor_male,
      });
      studentData.push({
        _id: 9,
        total_student: sch.total_student_pass,
        total_student_female: sch.total_female_student_pass,
        total_student_male: sch.total_male_student_pass,
        total_student_poor_1: sch.total_student_poor_1_pass,
        total_student_poor_1_female: sch.female_student_poor_1_pass,
        total_student_poor_1_male: sch.male_student_poor_1_pass,
        total_student_poor_2: sch.total_student_poor_2_pass,
        total_student_poor_2_female: sch.female_student_poor_2_pass,
        total_student_poor_2_male: sch.male_student_poor_2_pass,
        total_student_near_poor: sch.total_student_near_poor_pass,
        total_student_near_poor_female: sch.female_student_near_poor_pass,
        total_student_near_poor_male: sch.male_student_near_poor_pass,
        total_student_not_poor: sch.total_student_not_poor_pass,
        total_student_not_poor_female: sch.female_student_not_poor_pass,
        total_student_not_poor_male: sch.male_student_not_poor_pass,
      });

      studentData.push({
        _id: 10,
        total_student: sch.total_employment,
        total_student_female: sch.total_employment_female,
        total_student_male: sch.total_employment_male,
        total_student_poor_1: sch.total_employment_poor_1,
        total_student_poor_1_female: sch.employment_poor_1_female,
        total_student_poor_1_male: sch.employment_poor_1_male,
        total_student_poor_2: sch.total_employment_poor_2,
        total_student_poor_2_female: sch.employment_poor_2_female,
        total_student_poor_2_male: sch.employment_poor_2_male,
        total_student_near_poor: sch.total_employment_near_poor,
        total_student_near_poor_female: sch.employment_near_poor_female,
        total_student_near_poor_male: sch.employment_near_poor_male,
        total_student_not_poor: sch.total_employment_not_poor,
        total_student_not_poor_female: sch.employment_not_poor_female,
        total_student_not_poor_male: sch.employment_not_poor_male,
      });
      jsonData[i].student_data = studentData;
      jsonData[i] = CommonUtil.removeKeys(jsonData[i], keyToRemove);
    }
    return {
      // start_date: startDate,
      start_end: endDate,
      header_columns: headerColumns,
      report_data: jsonData,
      total_count: totalCount,
    };
  }

  async internshipStudentReport(req: any) {
    let { schools, student_internships } = req.query;
    let [skip, limit] = controllers.student.skipLimit(req);

    let maxToday = new Date(new Date(req.query.end_date).setHours(23, 59, 59));

    let matchStudent: any = {
      status: EnumConstant.ACTIVE,
    };

    if (req.body._user.schools) {
      schools = req.body._user.schools;
    }

    if (schools) {
      matchStudent.schools = new ObjectId(schools);
    }

    let matchStudentInternship: any = {};

    if (student_internships) {
      matchStudentInternship["student_internships.end_date"] = {
        $gte: maxToday,
      };
    }
    let data = await models.requestTimeline
      .aggregate([
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$students",
            createdAt: { $first: "$createdAt" },
          },
        },
        {
          $lookup: {
            from: "students",
            let: { id: "$_id", timelineCreatedAt: "$createdAt" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$_id", "$$id"] },
                  ...matchStudent,
                },
              },
              {
                $lookup: {
                  from: "student_internships",
                  let: { studentId: "$_id" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$students", "$$studentId"] },
                        start_date: { $lte: maxToday },
                      },
                    },
                    {
                      $lookup: {
                        from: "development_partners",
                        let: { partnerId: "$development_partners" },
                        pipeline: [
                          {
                            $match: {
                              $expr: { $eq: ["$_id", "$$partnerId"] },
                            },
                          },
                        ],
                        as: "development_partners",
                      },
                    },
                    {
                      $unwind: {
                        path: "$development_partners",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                  ],
                  as: "student_internships",
                },
              },
              {
                $unwind: {
                  path: "$student_internships",
                },
              },
              {
                $lookup: {
                  from: "courses",
                  let: { courseId: "$courses" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$_id", "$$courseId"] },
                      },
                    },
                  ],
                  as: "courses",
                },
              },
              {
                $unwind: {
                  path: "$courses",
                },
              },
            ],
            as: "students",
          },
        },
        {
          $unwind: "$students",
        },
        {
          $replaceRoot: {
            newRoot: "$students",
          },
        },

        {
          $project: {
            first_name: 1,
            last_name: 1,
            profile_image: 1,
            gender: 1,
            schools: 1,
            courses: {
              apply_majors: 1,
            },
            type_poverty_status: 1,
            student_internships: {
              start_date: 1,
              end_date: 1,
              pass_fail: 1,
              type_internships: 1,
              job_opportunity: 1,
              salary: 1,
              development_partners: {
                name: 1,
                name_en: 1,
                phone_number: 1,
                bussiness: 1,
                type_development_partners: 1,
                address: {
                  city_provinces: 1,
                  districts: 1,
                  villages: 1,
                },
              },
            },
          },
        },
        {
          $match: matchStudentInternship,
        },
        { $sort: { last_name: 1, first_name: 1 } },
        {
          $facet: {
            result: [
              { $skip: skip },
              ...(limit > 0 ? [{ $limit: limit }] : []),
            ],
            totalCount: [
              {
                $count: "count",
              },
            ],
          },
        },
      ])
      .allowDiskUse(true);

    let [getData, count] = await controllers.student.facetData(data, [
      {
        path: "schools",
        select: "name name_en profile_image",
        model: "schools",
      },
      { path: "courses.apply_majors", select: "name", model: "skills" },
      {
        path: "student_internships.development_partners.address.city_provinces",
        select: "name name_en",
        model: "city_provinces",
      },
      {
        path: "student_internships.development_partners.address.districts",
        select: "name name_en",
        model: "districts",
      },
      {
        path: "student_internships.development_partners.address.villages",
        select: "name name_en",
        model: "villages",
      },
    ]);

    let json = CommonUtil.JSONParse(getData);
    return [json, count];
  }
}
